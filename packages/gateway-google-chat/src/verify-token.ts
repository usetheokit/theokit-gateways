/**
 * The check every inbound request passes before anything reads its body as an event (FR-025):
 * an RS256 ID token signed by a key from Google's published set, for this app, from Chat.
 *
 * @internal
 */

import { type JwksKeySet, verifyRs256Jwt } from "@theokit/gateway";

/** Google's OAuth 2.0 signing keys as a JWK set, the keys that sign Chat's ID tokens. */
export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

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
  opts: { readonly keySet: JwksKeySet; readonly audience: string; readonly now: () => number },
): Promise<TokenVerdict> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  if (token === undefined) return refuse("no bearer token");
  const verified = await verifyRs256Jwt(token, opts.keySet);
  if (!verified.ok) {
    switch (verified.reason) {
      case "keys_unavailable":
        return { ok: false, status: 503, reason: "Google's key set could not be read" };
      case "malformed":
        return refuse("the token is not a JWT, or names no key");
      case "unsupported_alg":
        return refuse("the token is not signed with RS256");
      case "unknown_kid":
        return refuse("the token's key is not in Google's published set");
      case "bad_signature":
        return refuse("the signature does not verify");
    }
  }
  return claimsFault(verified.payload, opts.audience, opts.now()) ?? { ok: true };
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
