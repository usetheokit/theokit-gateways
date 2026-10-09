/**
 * `teamsActivityVerifier`: refuse an inbound Teams activity on an app's own HTTP route unless its
 * RS256 signature verifies under a published key, the Microsoft SDK validated its token, the
 * token's `aud`, `serviceurl` and `tid` claims match this app, and the activity's `channelId` is
 * `msteams` (ADR-0003, ADR-0005).
 *
 * The verifier reads the published key sets itself and checks the signature before the SDK is
 * asked, so the timing of every key-set request a sender can cause is decided here rather than by
 * the SDK's private key cache (ADR-0005). The SDK still reads the key again for a token whose
 * signature verified; when that read fails, the refusal is `key_set_unavailable`. Issuer, audience, expiry and `serviceurl` stay the SDK validator's, which
 * the SDK root does not export: it is read from `@microsoft/teams.apps/dist/middleware/index.js`,
 * as `InboundActivityTokenValidator` (2.1.x) or `ServiceTokenValidator` (2.0.x). The claim checks
 * run after it on both, because that validator alone restricts no tenant on the Bot Framework path
 * and compares no `serviceurl` on the 2.1.x Entra path.
 */

import { readBoundedStream } from "./bounded-stream.js";
import { keySet, keySetUrl, type PublishedKeySet, tenantKeySetUrl } from "./published-key-set.js";
import { verifiesRs256 } from "./rs256-signature.js";
import {
  type Loaded,
  loadValidator,
  type ResolvedToken,
  sdkCheck,
  type TokenValidatorLike,
} from "./sdk-validator.js";
import {
  assertVerifierOptions,
  checkVerifiedClaims,
  decodeVerifiedClaims,
  type ExpectedClaims,
  isTenantIssuedToken,
  type ParsedBody,
  parseActivityBody,
  readBearerToken,
  readTokenAlgorithm,
  readTokenKeyId,
  tenantRefusalBeforeVerification,
} from "./verified-claims.js";
import {
  type Refusal,
  refuse,
  type TeamsActivityVerifierOptions,
  type TeamsActivityVerifyResult,
} from "./verifier-contract.js";

export type {
  TeamsActivityVerifierOptions,
  TeamsActivityVerifyResult,
  TeamsCloudEndpoints,
} from "./verifier-contract.js";

/** `PUBLIC.loginEndpoint` in `@microsoft/teams.api`, which this package does not depend on. */
const DEFAULT_LOGIN_ENDPOINT = "https://login.microsoftonline.com";

/**
 * The largest body the verifier reads. The body is read before the token is verified, because the
 * `serviceurl` check needs the activity, so an unauthenticated sender controls this read.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * The parsed activity, `malformed_body` when the sender's bytes are over the limit, are not an
 * activity, are absent, or fail while being read, or `body_already_read` when the route handed over
 * a body already read or locked: no byte of it came from this read, so the sender is not at fault,
 * and the validator was never reached, so it is not `validator_unavailable` either.
 */
async function readBody(request: Request): Promise<ParsedBody | Refusal> {
  if (request.bodyUsed || request.body?.locked === true) {
    return refuse("body_already_read");
  }
  try {
    const text = await readBoundedStream(request.body, MAX_BODY_BYTES);
    return text === undefined ? { ok: false, reason: "malformed_body" } : parseActivityBody(text);
  } catch {
    return { ok: false, reason: "malformed_body" };
  }
}

const NO_KEY_ID =
  "the token is not a JWT whose header names its signing key (a non-empty string kid), so the Teams SDK was not asked";

const NOT_RS256 =
  "the token's header does not name RS256, the one algorithm the Teams SDK accepts, so the Teams SDK was not asked";

const KEY_NOT_PUBLISHED =
  "the token names a signing key the published key set, as last read, does not list, so the Teams SDK was not asked";

const BAD_SIGNATURE =
  "the token's RS256 signature does not verify against the published key it names, so the Teams SDK was not asked";

type ReadableActivity = Extract<ParsedBody, { ok: true }>;

/** The key sets a verifier reads: Bot Framework always, the tenant's only when one is configured. */
interface KeySets {
  readonly botFramework: PublishedKeySet;
  readonly tenant: PublishedKeySet | undefined;
}

type TenantExpectation = Pick<ExpectedClaims, "tenantId" | "loginEndpoint">;

/**
 * Whether the SDK may be asked about this token, or the refusal that needs no SDK work. In order:
 * a token with no `kid` (no genuine token omits it); a tenant-issued token whose unverified tenant
 * this verifier would refuse anyway; a header naming anything but RS256; a `kid` the matching key
 * set does not list (`key_set_unavailable` when the set could not be read); and a signature that
 * does not verify under the listed key. The key set is chosen by the unverified `iss`: an Entra
 * issuer is checked against the configured tenant's set, anything else against Bot Framework's.
 */
async function admitToSdk(
  rawToken: string,
  keySets: KeySets,
  expected: TenantExpectation,
): Promise<Refusal | undefined> {
  const kid = readTokenKeyId(rawToken);
  if (kid === undefined) return refuse("invalid_token", NO_KEY_ID);
  const tenantRefusal = tenantRefusalBeforeVerification(rawToken, expected);
  if (tenantRefusal !== undefined) return refuse(tenantRefusal);
  const set = isTenantIssuedToken(rawToken, expected.loginEndpoint)
    ? keySets.tenant
    : keySets.botFramework;
  if (set === undefined) return refuse("tenant_unverified");
  if (readTokenAlgorithm(rawToken) !== "RS256") return refuse("invalid_token", NOT_RS256);
  const listed = await set.lookup(kid);
  if (listed === "unlisted") return refuse("invalid_token", KEY_NOT_PUBLISHED);
  if ("unavailable" in listed) return refuse("key_set_unavailable", listed.unavailable);
  return verifiesRs256(rawToken, listed) ? undefined : refuse("invalid_token", BAD_SIGNATURE);
}

/** {@link sdkCheck} for a token whose signature {@link admitToSdk} verified. */
async function gatedSdkCheck(
  validator: TokenValidatorLike,
  keySets: KeySets,
  read: { readonly header: string; readonly rawToken: string; readonly body: ReadableActivity },
  expected: TenantExpectation,
): Promise<ResolvedToken | Refusal | undefined> {
  const refusal = await admitToSdk(read.rawToken, keySets, expected);
  if (refusal !== undefined) return refusal;
  return sdkCheck(validator, read.header, read.body.activity);
}

/** The header, its token and the parsed body, or the refusal that needs no SDK work. */
async function readRequest(
  request: Request,
): Promise<
  { readonly header: string; readonly rawToken: string; readonly body: ReadableActivity } | Refusal
> {
  const header = request.headers.get("authorization");
  const rawToken = readBearerToken(header);
  if (header === null || rawToken === undefined) return refuse("missing_authorization");
  const body = await readBody(request);
  if (!body.ok) return "message" in body ? body : refuse("malformed_body");
  return { header, rawToken, body };
}

/** The verdict on a token the SDK resolved (or refused): decode its claims and check them. */
function judgeVerifiedToken(
  token: ResolvedToken | undefined,
  rawToken: string,
  body: ReadableActivity,
  expected: { clientId: string; tenantId: string | undefined; loginEndpoint: string },
): TeamsActivityVerifyResult {
  const claims = token === undefined ? undefined : decodeVerifiedClaims(rawToken);
  if (token === undefined || claims === undefined) return refuse("invalid_token");
  const verdict = checkVerifiedClaims(claims, {
    ...expected,
    serviceUrl: body.serviceUrl,
    channelId: body.activity.channelId,
  });
  return verdict.ok ? { ok: true, activity: body.activity, token } : refuse(verdict.reason);
}

/**
 * Build a verifier for one Teams bot. The returned function reads a Fetch `Request` (pass a
 * `clone()` if the body is needed afterwards) and answers with {@link TeamsActivityVerifyResult}.
 * It reads at most 1 MiB of body: a larger one is `malformed_body`, refused before any token work,
 * and so is a body that fails part-way through the read or a POST with no body. A request whose
 * body was already read or is locked by another reader is `body_already_read`, a fault of the route
 * that no retry clears (answer it with a 500), whose message says to pass an unread request such as
 * `request.clone()`.
 *
 * It accepts only when the token's RS256 signature verifies under a key the published key set
 * lists, the SDK validator accepted the token, AND the token's `aud`, `serviceurl` and tenant
 * claims match this configuration AND the activity's `channelId` is `msteams`; it never throws for a
 * request. An activity from the bot's other channels (Web Chat, Direct Line, the Bot Framework
 * Emulator) is `channel_mismatch` even with a genuine token, a client fault: answer it with a 4xx. The SDK is imported on the first
 * request, once per verifier; a failed load is kept, so every later request refuses as
 * `validator_unavailable` until the verifier is rebuilt.
 *
 * Before the SDK is asked, a token with no `kid` or whose header names anything but RS256 is
 * `invalid_token`, and so is one whose signature does not verify; a tenant-issued token whose
 * unverified tenant would be refused gets that tenant reason. The verifier reads the Bot Framework
 * key set (and, with `tenantId`, that tenant's) itself: when it holds no copy or the copy lacks the
 * `kid`, and in the background when the copy is an hour old, never within 10 seconds of the end of
 * the previous read whatever is sent. A key Microsoft publishes is therefore accepted
 * within 10 seconds of the last read. A key set that cannot be read and does not already list the
 * `kid` is `key_set_unavailable`, which is retryable: answer it with a 503, not a 401; so is a token
 * whose signature verified when the SDK then reports it could not read the key itself. A `check()`
 * that fails with anything but the SDK's plain `Error` is `validator_unavailable`, naming its class.
 *
 * @throws TypeError at construction for an empty `clientId`, an empty or multi-tenant `tenantId`,
 * a `cloud` missing one of its three endpoints or with one that is not an `https:` URL (`http:` is
 * accepted on a loopback host only), a `cloud.loginEndpoint` ending in a slash, or a
 * `cloud.openIdMetadataUrl` that does not end in `/openidconfiguration`.
 * @public
 */
export function teamsActivityVerifier(
  options: TeamsActivityVerifierOptions,
): (request: Request) => Promise<TeamsActivityVerifyResult> {
  assertVerifierOptions(options);
  let loaded: Promise<Loaded> | undefined;
  const expected = {
    clientId: options.clientId,
    tenantId: options.tenantId,
    loginEndpoint: options.cloud?.loginEndpoint ?? DEFAULT_LOGIN_ENDPOINT,
  };
  const keySets: KeySets = {
    botFramework: keySet("Bot Framework", keySetUrl(options.cloud?.openIdMetadataUrl)),
    tenant:
      options.tenantId === undefined
        ? undefined
        : keySet(
            `tenant ${options.tenantId}`,
            tenantKeySetUrl(expected.loginEndpoint, options.tenantId),
          ),
  };

  return async (request: Request): Promise<TeamsActivityVerifyResult> => {
    const read = await readRequest(request);
    if ("reason" in read) return read;

    loaded ??= loadValidator(options);
    const load = await loaded;
    if ("unavailable" in load) return refuse("validator_unavailable", load.unavailable);

    const token = await gatedSdkCheck(load.validator, keySets, read, expected);
    if (token !== undefined && "reason" in token) return token;
    return judgeVerifiedToken(token, read.rawToken, read.body, expected);
  };
}
