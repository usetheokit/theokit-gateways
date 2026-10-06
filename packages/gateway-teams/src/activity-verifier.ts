/**
 * `teamsActivityVerifier`: refuse an inbound Teams activity on an app's own HTTP route unless the
 * Microsoft SDK validated its token and the token's `aud`, `serviceurl` and `tid` claims match this
 * app (ADR-0003).
 *
 * The signature, key-set and expiry work belongs to the SDK's own inbound validator, which the SDK
 * root does not export: it is read from `@microsoft/teams.apps/dist/middleware/index.js`, as
 * `InboundActivityTokenValidator` (2.1.x) or `ServiceTokenValidator` (2.0.x). The claim checks run
 * after it on both, because that validator alone restricts no tenant on the Bot Framework path and
 * compares no `serviceurl` on the 2.1.x Entra path.
 */

import { Buffer } from "node:buffer";

import {
  assertVerifierOptions,
  checkVerifiedClaims,
  decodeVerifiedClaims,
  type ParsedBody,
  parseActivityBody,
  readBearerToken,
  readTokenKeyId,
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
  /** The OpenID metadata URL; the SDK derives the key-set URL from it. */
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
        | "audience_mismatch"
        | "serviceurl_mismatch"
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

const MESSAGES: Readonly<Record<RefusalReason, string>> = {
  missing_authorization: "no Authorization header: the request carries no Bot Framework token",
  malformed_body:
    "the request body is over 1 MiB or is not a readable JSON activity with a non-empty string serviceUrl",
  validator_unavailable: "the Teams SDK token validator could not be loaded",
  invalid_token:
    "the Teams SDK did not accept the token (bad signature, unknown key, wrong audience or issuer, expired, or a serviceurl it compared and found different)",
  audience_mismatch: "the token's aud claim is not this bot's app id",
  serviceurl_mismatch:
    "the token's serviceurl claim is absent or differs from the activity's serviceUrl",
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

/**
 * The logger handed to the SDK validator. Without one the SDK logs every refused token through its
 * `ConsoleLogger`, claim values included, and those values are chosen by whoever sent the request.
 */
const SILENT_LOGGER: SdkLogger = {
  error: ignore,
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

/** The body as text, or `undefined` once it passes {@link MAX_BODY_BYTES}. Reads no further. */
async function readBoundedText(request: Request): Promise<string | undefined> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function readBody(request: Request): Promise<ParsedBody> {
  try {
    const text = await readBoundedText(request);
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

/**
 * The SDK's verdict on this exact header: the token it resolved, `undefined` when it refused the
 * token, or a `validator_unavailable` refusal when `check()` failed in a way that is no verdict.
 */
async function sdkCheck(
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
 * How many tokens whose `kid` no accepted token used may reach the SDK per window. The SDK's
 * key-set client is built with its rate limit off and caches only keys it found, so each such token
 * is one key-set request, made before any signature check, for a value the sender chose. Ten per
 * minute is that client's own default request limit, the bound the SDK leaves off.
 */
const UNKNOWN_KEY_CHECKS_PER_WINDOW = 10;
const UNKNOWN_KEY_WINDOW_MS = 60_000;

const UNKNOWN_KEY_LIMITED =
  "the token names a signing key no accepted token used, and the verifier already asked the Teams SDK about 10 such tokens this minute";

/**
 * Which tokens may reach the SDK. A `kid` an accepted token used always may; any other (or none)
 * spends one of {@link UNKNOWN_KEY_CHECKS_PER_WINDOW} per fixed window. Only a kid whose token the
 * SDK accepted is learned, so the known set holds keys the key set really published.
 */
function unknownKeyBudget(): {
  admit(kid: string | undefined): boolean;
  learn(kid: string | undefined): void;
} {
  const known = new Set<string>();
  let windowStart = Number.NEGATIVE_INFINITY;
  let used = 0;
  return {
    admit(kid) {
      if (kid !== undefined && known.has(kid)) return true;
      const now = Date.now();
      if (now - windowStart >= UNKNOWN_KEY_WINDOW_MS) {
        windowStart = now;
        used = 0;
      }
      if (used >= UNKNOWN_KEY_CHECKS_PER_WINDOW) return false;
      used += 1;
      return true;
    },
    learn(kid) {
      if (kid !== undefined) known.add(kid);
    },
  };
}

type ReadableActivity = Extract<ParsedBody, { ok: true }>;
type KeyBudget = ReturnType<typeof unknownKeyBudget>;

/**
 * {@link sdkCheck}, unless the token's `kid` is unknown and the budget for unknown kids is spent;
 * a kid the SDK accepted is learned.
 */
async function budgetedSdkCheck(
  validator: TokenValidatorLike,
  budget: KeyBudget,
  read: { readonly header: string; readonly rawToken: string; readonly body: ReadableActivity },
): Promise<ResolvedToken | Refusal | undefined> {
  const kid = readTokenKeyId(read.rawToken);
  if (!budget.admit(kid)) return refuse("invalid_token", UNKNOWN_KEY_LIMITED);
  const token = await sdkCheck(validator, read.header, read.body.activity);
  if (token !== undefined && !("reason" in token)) budget.learn(kid);
  return token;
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
  const verdict = checkVerifiedClaims(claims, { ...expected, serviceUrl: body.serviceUrl });
  return verdict.ok ? { ok: true, activity: body.activity, token } : refuse(verdict.reason);
}

/**
 * Build a verifier for one Teams bot. The returned function reads a Fetch `Request` (pass a
 * `clone()` if the body is needed afterwards) and answers with {@link TeamsActivityVerifyResult}.
 * It reads at most 1 MiB of body: a larger one is `malformed_body`, refused before any token work.
 *
 * It accepts only when the SDK validator accepted the token AND the token's `aud`, `serviceurl`
 * and tenant claims match this configuration; it never throws for a request. The SDK is imported
 * on the first request, once per verifier; a failed load is kept, so every later request refuses
 * as `validator_unavailable` until the verifier is rebuilt. A key-set outage reads as
 * `invalid_token`, the same as a forgery, and the next request retries. At most ten tokens a
 * minute whose `kid` no accepted token used reach the SDK; the rest are `invalid_token` with no
 * key-set request, and a kid an accepted token used is never limited. A `check()` that fails
 * with anything but the SDK's plain `Error` is `validator_unavailable`, naming the error's class.
 *
 * @throws TypeError at construction for an empty `clientId`, an empty or multi-tenant `tenantId`,
 * or a `cloud` missing one of its three endpoints.
 * @public
 */
export function teamsActivityVerifier(
  options: TeamsActivityVerifierOptions,
): (request: Request) => Promise<TeamsActivityVerifyResult> {
  assertVerifierOptions(options);
  let loaded: Promise<Loaded> | undefined;
  const budget = unknownKeyBudget();
  const expected = {
    clientId: options.clientId,
    tenantId: options.tenantId,
    loginEndpoint: options.cloud?.loginEndpoint ?? DEFAULT_LOGIN_ENDPOINT,
  };

  return async (request: Request): Promise<TeamsActivityVerifyResult> => {
    const read = await readRequest(request);
    if ("reason" in read) return read;

    loaded ??= loadValidator(options);
    const load = await loaded;
    if ("unavailable" in load) return refuse("validator_unavailable", load.unavailable);

    const token = await budgetedSdkCheck(load.validator, budget, read);
    if (token !== undefined && "reason" in token) return token;
    return judgeVerifiedToken(token, read.rawToken, read.body, expected);
  };
}
