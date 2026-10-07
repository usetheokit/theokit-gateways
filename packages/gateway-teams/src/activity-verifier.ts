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

import { AsyncLocalStorage } from "node:async_hooks";
import { Buffer } from "node:buffer";
import { createPublicKey, type JsonWebKey, type KeyObject, verify } from "node:crypto";

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

/**
 * The three cloud endpoints the SDK validator reads. The SDK's own `CloudEnvironment` values
 * (`PUBLIC`, `US_GOV`, `CHINA`, ...) are assignable to it, so a sovereign cloud is passed as is.
 *
 * @public
 */
export interface TeamsCloudEndpoints {
  /** The Entra login endpoint, e.g. `https://login.microsoftonline.com`. */
  readonly loginEndpoint: string;
  /** The Bot Framework token issuer, e.g. `https://api.botframework.com`. */
  readonly tokenIssuer: string;
  /**
   * The OpenID metadata URL; the SDK and the verifier derive the Bot Framework key-set URL from it
   * by replacing its trailing `/openidconfiguration` with `/keys`, so it must end in that suffix.
   */
  readonly openIdMetadataUrl: string;
}

/**
 * Options for {@link teamsActivityVerifier}.
 *
 * @public
 */
export interface TeamsActivityVerifierOptions {
  /** The bot's Microsoft app id: the audience every accepted token must carry. */
  readonly clientId: string;
  /**
   * Restrict accepted tokens to this tenant. A token whose `tid` differs is `tenant_mismatch`, and
   * one with no `tid` is `tenant_unverified`. Microsoft documents no `tid` on Bot Framework
   * connector tokens, so with this set every such activity may be refused; omit it on that path.
   * `common`, `organizations` and `consumers` name no tenant and are refused at construction.
   */
  readonly tenantId?: string;
  /** The cloud to validate against. Defaults to the SDK's public cloud. */
  readonly cloud?: TeamsCloudEndpoints;
  /** Test seam: a module standing in for the SDK's middleware module. @internal */
  readonly __validatorModule?: unknown;
}

/**
 * What the verifier answers. On success it returns the parsed activity and the token's app id and
 * service URL; on refusal, one typed `reason` and a `message` that never contains the token.
 *
 * @public
 */
export type TeamsActivityVerifyResult =
  | {
      readonly ok: true;
      readonly activity: Readonly<Record<string, unknown>>;
      readonly token: { readonly appId: string; readonly serviceUrl: string };
    }
  | {
      readonly ok: false;
      readonly reason:
        | "missing_authorization"
        | "malformed_body"
        | "validator_unavailable"
        | "invalid_token"
        | "key_set_unavailable"
        | "audience_mismatch"
        | "serviceurl_mismatch"
        | "channel_mismatch"
        | "tenant_mismatch"
        | "tenant_unverified";
      readonly message: string;
    };

type Refusal = Extract<TeamsActivityVerifyResult, { ok: false }>;
type RefusalReason = Refusal["reason"];

/** The SDK module the validator is read from. Unpublished path: ADR-0003. */
const MIDDLEWARE_MODULE = "@microsoft/teams.apps/dist/middleware/index.js";

/** `PUBLIC.loginEndpoint` in `@microsoft/teams.api`, which this package does not depend on. */
const DEFAULT_LOGIN_ENDPOINT = "https://login.microsoftonline.com";

/** `PUBLIC.openIdMetadataUrl` in `@microsoft/teams.api`. */
const DEFAULT_OPENID_METADATA_URL =
  "https://login.botframework.com/v1/.well-known/openidconfiguration";

const MESSAGES: Readonly<Record<RefusalReason, string>> = {
  missing_authorization: "no Authorization header: the request carries no Bot Framework token",
  malformed_body:
    "the request body is over 1 MiB or is not a readable JSON activity with a non-empty string serviceUrl",
  validator_unavailable: "the Teams SDK token validator could not be loaded",
  invalid_token:
    "the Teams SDK did not accept the token (bad signature, unknown key, wrong audience or issuer, expired, or a serviceurl it compared and found different)",
  key_set_unavailable:
    "the published signing keys could not be read, so the token's signature could not be checked; a retry may succeed",
  audience_mismatch: "the token's aud claim is not this bot's app id",
  serviceurl_mismatch:
    "the token's serviceurl claim is absent or differs from the activity's serviceUrl",
  channel_mismatch:
    "the activity's channelId is absent or is not msteams: the token is the bot's, but the activity did not come from Teams",
  tenant_mismatch: "the token's tid claim names a tenant other than the configured one",
  tenant_unverified:
    "the token's tenant cannot be confirmed: no tid with a tenant configured, or a tenant-issued token with none configured",
};

const WHICH_VALIDATOR = `${MIDDLEWARE_MODULE} exporting InboundActivityTokenValidator or ServiceTokenValidator`;

/** The two members of the SDK validator this verifier calls. */
interface TokenValidatorLike {
  check(authHeader: string, body: unknown): Promise<unknown>;
}

/** The SDK's `ILogger` shape, as far as its validators call it. */
interface SdkLogger {
  error(...msg: unknown[]): void;
  warn(...msg: unknown[]): void;
  info(...msg: unknown[]): void;
  debug(...msg: unknown[]): void;
  trace(...msg: unknown[]): void;
  log(level: string, ...msg: unknown[]): void;
  child(name: string): SdkLogger;
}

type ValidatorClass = new (
  appId: string,
  tenantId?: string,
  serviceUrl?: string,
  logger?: SdkLogger,
  cloud?: TeamsCloudEndpoints,
) => TokenValidatorLike;

const ignore = (): void => {};

/** What one `check()` call learned from the SDK's logger. */
interface SdkCheckReport {
  keyReadFailed: boolean;
}

/** The report of the `check()` call whose async context the SDK logs from. */
const sdkCheckReports = new AsyncLocalStorage<SdkCheckReport>();

/**
 * The text the SDK's `JwtValidator` logs, with the key client's error, when it cannot get a
 * signing key (2.0.15, 2.0.16 and 2.1.0 read alike). It refuses the token as it refuses a forgery
 * right after, so this log line is the one place the two can be told apart.
 */
const SDK_KEY_READ_FAILED = "Failed to get signing key";

/**
 * Note, for the `check()` in progress, that the SDK could not read the signing key. A
 * `SigningKeyNotFoundError` is left out: there the read succeeded and the set did not list the key,
 * which is a refusal on the merits. Writes nothing anywhere.
 */
function noteSdkKeyReadFailure(...msg: unknown[]): void {
  const [text, cause] = msg;
  if (typeof text !== "string" || !text.startsWith(SDK_KEY_READ_FAILED)) return;
  if ((cause as { name?: unknown } | null)?.name === "SigningKeyNotFoundError") return;
  const report = sdkCheckReports.getStore();
  if (report !== undefined) report.keyReadFailed = true;
}

/**
 * The logger handed to the SDK validator. Without one the SDK logs every refused token through its
 * `ConsoleLogger`, claim values included, and those values are chosen by whoever sent the request.
 * It writes nothing; its `error` only notes a failed key read for the `check()` that logged it.
 */
const SILENT_LOGGER: SdkLogger = {
  error: noteSdkKeyReadFailure,
  warn: ignore,
  info: ignore,
  debug: ignore,
  trace: ignore,
  log: ignore,
  child: () => SILENT_LOGGER,
};

/** The SDK middleware module, as far as this verifier reads it. */
interface ValidatorModuleLike {
  readonly InboundActivityTokenValidator?: unknown;
  readonly ServiceTokenValidator?: unknown;
  readonly default?: ValidatorModuleLike;
}

/** The token fields the SDK validator resolved for an accepted request. */
type ResolvedToken = { readonly appId: string; readonly serviceUrl: string };

type Loaded = { readonly validator: TokenValidatorLike } | { readonly unavailable: string };

function refuse(reason: RefusalReason, message: string = MESSAGES[reason]): Refusal {
  return { ok: false, reason, message };
}

function validatorClass(mod: ValidatorModuleLike | undefined): ValidatorClass | undefined {
  const named =
    mod?.InboundActivityTokenValidator || mod?.ServiceTokenValidator ? mod : mod?.default;
  const ctor = named?.InboundActivityTokenValidator ?? named?.ServiceTokenValidator;
  return typeof ctor === "function" ? (ctor as ValidatorClass) : undefined;
}

async function importMiddleware(options: TeamsActivityVerifierOptions): Promise<unknown> {
  if (options.__validatorModule !== undefined) return options.__validatorModule;
  // A literal specifier, not MIDDLEWARE_MODULE: the bundler keeps only a static one external.
  return import("@microsoft/teams.apps/dist/middleware/index.js");
}

/** An identifier-shaped value, so nothing but a class name or an error code reaches a message. */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * The kind of a caught failure, for a refusal message: the error's class and, when it carries one,
 * its `code` (`TypeError`, `Error ERR_MODULE_NOT_FOUND`). The error's own text is left out: it
 * belongs to the SDK or the module loader, and a refusal repeats only what the verifier decided.
 */
function errorKind(error: unknown): string {
  if (typeof error !== "object" || error === null) return `a thrown ${typeof error}`;
  const { name, code } = error as { name?: unknown; code?: unknown };
  const kind = typeof name === "string" && IDENTIFIER.test(name) ? name : "an unnamed error";
  return typeof code === "string" && IDENTIFIER.test(code) ? `${kind} ${code}` : kind;
}

/** The validator class the module exports, or a reason it cannot be had. Never throws. */
async function resolveValidatorClass(
  options: TeamsActivityVerifierOptions,
): Promise<ValidatorClass | string> {
  let mod: unknown;
  try {
    mod = await importMiddleware(options);
  } catch (error) {
    return `could not import ${WHICH_VALIDATOR} (${errorKind(error)})`;
  }
  try {
    return (
      validatorClass(mod as ValidatorModuleLike | undefined) ??
      `found neither class: expected ${WHICH_VALIDATOR}`
    );
  } catch (error) {
    return `could not read the validator classes of ${WHICH_VALIDATOR} (${errorKind(error)})`;
  }
}

/** Load and construct the SDK validator once. Every failure is a value, never a rejection. */
async function loadValidator(options: TeamsActivityVerifierOptions): Promise<Loaded> {
  const Validator = await resolveValidatorClass(options);
  if (typeof Validator === "string") return { unavailable: Validator };
  try {
    const validator = new Validator(
      options.clientId,
      options.tenantId,
      undefined,
      SILENT_LOGGER,
      options.cloud,
    );
    return { validator };
  } catch (error) {
    return {
      unavailable: `could not construct the validator from ${WHICH_VALIDATOR} (${errorKind(error)})`,
    };
  }
}

/**
 * The largest body the verifier reads. The body is read before the token is verified, because the
 * `serviceurl` check needs the activity, so an unauthenticated sender controls this read.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/** A stream as text, or `undefined` once it passes `maxBytes`. Reads no further. */
async function readBoundedStream(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | undefined> {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function readBody(request: Request): Promise<ParsedBody> {
  try {
    const text = await readBoundedStream(request.body, MAX_BODY_BYTES);
    return text === undefined ? { ok: false, reason: "malformed_body" } : parseActivityBody(text);
  } catch {
    return { ok: false, reason: "malformed_body" };
  }
}

/**
 * Whether a throw from `check()` is the SDK refusing the token. Both 2.0.x and 2.1.x refuse with a
 * plain `Error` ("Invalid token", "No token provided", "Entra inbound token is missing tid"); a
 * `TypeError` or any other throw is the validator itself failing.
 */
function isTokenRefusal(error: unknown): boolean {
  return error instanceof Error && error.constructor === Error;
}

const SDK_KEYS_UNREADABLE =
  "the Teams SDK could not read the published signing keys to check the token, so it could not judge it; a retry may succeed";

/** The SDK's verdict, read in {@link sdkCheck}: the resolved token, or `undefined` for a refusal. */
async function sdkVerdict(
  validator: TokenValidatorLike,
  header: string,
  activity: Record<string, unknown>,
): Promise<ResolvedToken | Refusal | undefined> {
  try {
    const result = (await validator.check(header, activity)) as
      | { appId?: unknown; serviceUrl?: unknown }
      | null
      | undefined;
    const { appId, serviceUrl } = result ?? {};
    if (typeof appId !== "string" || typeof serviceUrl !== "string") return undefined;
    return { appId, serviceUrl };
  } catch (error) {
    if (isTokenRefusal(error)) return undefined;
    return refuse(
      "validator_unavailable",
      `the Teams SDK token validator failed instead of judging the token (${errorKind(error)})`,
    );
  }
}

/**
 * The SDK's verdict on this exact header: the token it resolved, `undefined` when it refused the
 * token, or a refusal when its answer is no verdict on the token: `validator_unavailable` when
 * `check()` failed with something but its own refusal, and `key_set_unavailable` when it refused
 * after failing to read the signing key. Only a token whose signature this verifier already
 * verified reaches here, so that refusal is the SDK's key endpoint failing, not a forgery.
 */
async function sdkCheck(
  validator: TokenValidatorLike,
  header: string,
  activity: Record<string, unknown>,
): Promise<ResolvedToken | Refusal | undefined> {
  const report: SdkCheckReport = { keyReadFailed: false };
  const verdict = await sdkCheckReports.run(report, () => sdkVerdict(validator, header, activity));
  if (verdict === undefined && report.keyReadFailed) {
    return refuse("key_set_unavailable", SDK_KEYS_UNREADABLE);
  }
  return verdict;
}

/**
 * The least time between the end of one read of a key set and the start of the next, whatever asks
 * for the read.
 */
const KEY_SET_READ_INTERVAL_MS = 10_000;

/**
 * The age at which a held key set is read again even though it lists the key asked for, so a key
 * Microsoft retired stops verifying once that read completes. The read runs in the background: the
 * key is answered from the held copy meanwhile. A proposal, not a measurement: the SDK's own key
 * client, which still checks every token after this verifier, keeps a key for 10 minutes.
 */
const KEY_SET_MAX_AGE_MS = 60 * 60 * 1000;

/** How long one read of a key set may take before it counts as failed. */
const KEY_SET_READ_TIMEOUT_MS = 10_000;

/** The largest key-set document the verifier reads. Microsoft's is far smaller. */
const MAX_KEY_SET_BYTES = 1024 * 1024;

/** The most keys one key-set document may list; a document listing more is a failed read. */
const MAX_KEYS_PER_SET = 1000;

const NO_KEY_ID =
  "the token is not a JWT whose header names its signing key (a non-empty string kid), so the Teams SDK was not asked";

const NOT_RS256 =
  "the token's header does not name RS256, the one algorithm the Teams SDK accepts, so the Teams SDK was not asked";

const KEY_NOT_PUBLISHED =
  "the token names a signing key the published key set, as last read, does not list, so the Teams SDK was not asked";

const BAD_SIGNATURE =
  "the token's RS256 signature does not verify against the published key it names, so the Teams SDK was not asked";

/**
 * The key-set URL the SDK validator derives from the cloud's OpenID metadata URL: both 2.0.15 and
 * 2.1.0 replace a trailing `/openidconfiguration` with `/keys` and fetch that, without reading the
 * metadata document. Construction refuses a metadata URL without that suffix.
 */
function keySetUrl(cloud: TeamsCloudEndpoints | undefined): string {
  const metadata = cloud?.openIdMetadataUrl ?? DEFAULT_OPENID_METADATA_URL;
  return metadata.replace(/\/openidconfiguration$/, "/keys");
}

/** The key-set URL SDK 2.1.x derives for a tenant-issued token naming `tenantId`. */
function tenantKeySetUrl(loginEndpoint: string, tenantId: string): string {
  return `${loginEndpoint}/${tenantId}/discovery/v2.0/keys`;
}

/**
 * The `key_set_unavailable` message for one key set: which set, its URL, and why its latest read
 * failed. All three come from the configuration and the key endpoint, none from the request.
 */
function keySetUnavailableMessage(
  label: string,
  url: string,
  failure: KeySetReadFailure | undefined,
): string {
  const why = failure === undefined ? "" : `: ${failure.failed}`;
  return `the published signing keys could not be read (${label} key set at ${url}${why}), so the token's signature could not be checked; a retry may succeed`;
}

/** An RSA public key from one key-set entry, or `undefined` when the entry holds none. */
function rsaPublicKey(
  entry: unknown,
): { readonly kid: string; readonly publicKey: KeyObject } | undefined {
  const kid = (entry as { kid?: unknown } | null)?.kid;
  if (typeof kid !== "string" || kid.length === 0) return undefined;
  try {
    const publicKey = createPublicKey({ key: entry as JsonWebKey, format: "jwk" });
    return publicKey.asymmetricKeyType === "rsa" ? { kid, publicKey } : undefined;
  } catch {
    return undefined;
  }
}

/** Why one read of a key set produced no key set, in words an operator can act on. */
interface KeySetReadFailure {
  readonly failed: string;
}

/**
 * The RSA keys of a key-set document by `kid`, or the failure when it is not one: no `keys` array,
 * or more than {@link MAX_KEYS_PER_SET} entries. An entry with no usable RSA key is skipped.
 */
function publishedKeys(document: unknown): Map<string, KeyObject> | KeySetReadFailure {
  const entries = (document as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(entries)) return { failed: "the document has no keys array" };
  if (entries.length > MAX_KEYS_PER_SET) {
    return { failed: `the document lists more than ${MAX_KEYS_PER_SET} keys` };
  }
  const found = new Map<string, KeyObject>();
  for (const entry of entries) {
    const usable = rsaPublicKey(entry);
    if (usable !== undefined) found.set(usable.kid, usable.publicKey);
  }
  return found;
}

/**
 * A failed request or body read: the timeout, or the network error's class and code (`TypeError`
 * from `fetch` carries the socket error, e.g. `ECONNREFUSED`, as its `cause`). Never the error's
 * text.
 */
function requestFailure(error: unknown): KeySetReadFailure {
  if ((error as { name?: unknown } | null)?.name === "TimeoutError") {
    return { failed: `no answer within ${KEY_SET_READ_TIMEOUT_MS / 1000} s` };
  }
  const cause = (error as { cause?: unknown } | null)?.cause;
  return { failed: `the request failed (${errorKind(cause ?? error)})` };
}

/** The body of a key-set response as text, or the failure: too large, or the read failed. */
async function readKeySetText(response: Response): Promise<string | KeySetReadFailure> {
  try {
    const text = await readBoundedStream(response.body, MAX_KEY_SET_BYTES);
    return text ?? { failed: `the document is over ${MAX_KEY_SET_BYTES} bytes` };
  } catch (error) {
    return requestFailure(error);
  }
}

/** Fetch a key set, or the reason it could not be had: network, status, timeout, size or shape. */
async function readKeySet(url: string): Promise<Map<string, KeyObject> | KeySetReadFailure> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(KEY_SET_READ_TIMEOUT_MS) });
  } catch (error) {
    return requestFailure(error);
  }
  if (!response.ok) {
    // The status is the failure reported; a body that will not cancel changes nothing about it.
    await response.body?.cancel().catch(ignore);
    return { failed: `HTTP ${response.status}` };
  }
  const text = await readKeySetText(response);
  if (typeof text !== "string") return text;
  try {
    return publishedKeys(JSON.parse(text));
  } catch {
    return { failed: "the document is not JSON" };
  }
}

/**
 * What a key set answers for a `kid`: the key, `unlisted` after a read that succeeded without it,
 * or `unavailable` with the refusal message naming the set and why its latest read failed.
 */
type KeyLookup = KeyObject | "unlisted" | { readonly unavailable: string };

/**
 * One published key set, read by this verifier and nothing else. A `kid` the held copy lists is
 * answered from it at once; when the copy is older than {@link KEY_SET_MAX_AGE_MS}, a read is
 * started in the background and not awaited (stale-while-revalidate). A `kid` the copy lacks, or
 * any `kid` when there is no copy, waits for a read. Concurrent lookups share the read in flight,
 * and no read starts within {@link KEY_SET_READ_INTERVAL_MS} of the end of the previous one (so
 * nor of its start), whatever asked: an endpoint that hangs until the read times out cannot drive
 * reads back to back. A successful read replaces the copy, so a retired key is gone
 * after it; a failed read keeps the last good copy. A `kid` missing after a successful read is
 * `unlisted`; one missing when there is no copy, or when the latest read failed, is `unavailable`.
 */
function keySet(label: string, url: string): { lookup(kid: string): Promise<KeyLookup> } {
  let held: Map<string, KeyObject> | undefined;
  let readAt = Number.NEGATIVE_INFINITY;
  let nextReadAt = Number.NEGATIVE_INFINITY;
  /** Why the latest read failed; `undefined` once a read succeeds. */
  let lastFailure: KeySetReadFailure | undefined;
  let reading: Promise<void> | undefined;
  /** Never rejects: {@link readKeySet} turns every failure into a value. */
  const read = async (): Promise<void> => {
    const fresh = await readKeySet(url);
    if (fresh instanceof Map) {
      lastFailure = undefined;
      held = fresh;
      readAt = Date.now();
    } else lastFailure = fresh;
  };
  const unavailable = (): KeyLookup => ({
    unavailable: keySetUnavailableMessage(label, url, lastFailure),
  });
  /** The read in flight, started now if none is and the interval allows one. */
  const currentRead = (now: number): Promise<void> | undefined => {
    if (reading === undefined && now >= nextReadAt) {
      reading = read().finally(() => {
        nextReadAt = Date.now() + KEY_SET_READ_INTERVAL_MS;
        reading = undefined;
      });
    }
    return reading;
  };
  return {
    async lookup(kid) {
      const now = Date.now();
      const listed = held?.get(kid);
      if (listed !== undefined) {
        if (now - readAt >= KEY_SET_MAX_AGE_MS) void currentRead(now);
        return listed;
      }
      await currentRead(now);
      const found = held?.get(kid);
      if (found !== undefined) return found;
      return held === undefined || lastFailure !== undefined ? unavailable() : "unlisted";
    },
  };
}

/** Whether `rawToken`'s RS256 signature verifies under `publicKey`. Never throws. */
function verifiesRs256(rawToken: string, publicKey: KeyObject): boolean {
  const [header, payload, signature] = rawToken.split(".");
  if (header === undefined || payload === undefined || signature === undefined) return false;
  try {
    return verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

type ReadableActivity = Extract<ParsedBody, { ok: true }>;

/** The key sets a verifier reads: Bot Framework always, the tenant's only when one is configured. */
interface KeySets {
  readonly botFramework: ReturnType<typeof keySet>;
  readonly tenant: ReturnType<typeof keySet> | undefined;
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
  return body.ok ? { header, rawToken, body } : refuse("malformed_body");
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
 * It reads at most 1 MiB of body: a larger one is `malformed_body`, refused before any token work.
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
 * a `cloud` missing one of its three endpoints, or a `cloud.openIdMetadataUrl` that does not end
 * in `/openidconfiguration`.
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
    botFramework: keySet("Bot Framework", keySetUrl(options.cloud)),
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
