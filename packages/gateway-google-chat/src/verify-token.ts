/**
 * The check every inbound request passes before anything reads its body as an event (FR-025):
 * an RS256 ID token signed by a key from Google's published set, for this app, from Chat.
 *
 * @internal
 */

import { type KeySet, KeySetUnavailableError } from "./key-set.js";
import { decodeJwt, verifiesRs256 } from "./rs256.js";

/** The issuers Google writes in an ID token. */
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
/** The account Chat signs its requests as. */
export const CHAT_SERVICE_ACCOUNT = "chat@system.gserviceaccount.com";
/** Clock skew allowed past a token's `exp`. */
const EXPIRY_SKEW_MS = 60_000;

/** What the route answers: accept, refuse as forged (401), or refuse as unverifiable (503). */
export type TokenVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 401 | 503; readonly reason: string };

/**
 * Verify the `Authorization` header of one request. Nothing in the request can make it throw.
 *
 * @param authorization - the raw header value, `Bearer <token>`
 */
export async function verifyChatRequest(
  authorization: string | undefined,
  opts: { readonly keySet: KeySet; readonly audience: string; readonly now: () => number },
): Promise<TokenVerdict> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  if (token === undefined) return refuse("no bearer token");
  const jwt = decodeJwt(token);
  if (jwt === undefined) return refuse("the token is not a JWT");
  const kid = jwt.header.kid;
  if (typeof kid !== "string") return refuse("the token names no key");
  let key: Awaited<ReturnType<KeySet["forKid"]>>;
  try {
    key = await opts.keySet.forKid(kid);
  } catch (err) {
    if (err instanceof KeySetUnavailableError)
      return { ok: false, status: 503, reason: err.message };
    throw err;
  }
  if (key === undefined) return refuse("the token's key is not in Google's published set");
  if (!verifiesRs256(jwt, key)) return refuse("the signature does not verify");
  return claimsFault(jwt.payload, opts.audience, opts.now()) ?? { ok: true };
}

/** The first claim that disqualifies the token, as a refusal; `undefined` when all hold. */
function claimsFault(
  claims: Readonly<Record<string, unknown>>,
  audience: string,
  now: number,
): TokenVerdict | undefined {
  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) return refuse("wrong issuer");
  if (claims.aud !== audience) return refuse("wrong audience");
  if (claims.email !== CHAT_SERVICE_ACCOUNT) return refuse("not sent by Google Chat");
  if (claims.email_verified !== true) return refuse("the sender's email is not verified");
  if (typeof claims.exp !== "number" || claims.exp * 1000 + EXPIRY_SKEW_MS <= now) {
    return refuse("the token has expired");
  }
  return undefined;
}

function refuse(reason: string): TokenVerdict {
  return { ok: false, status: 401, reason };
}
