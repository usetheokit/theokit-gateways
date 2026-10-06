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

import {
  assertVerifierOptions,
  checkVerifiedClaims,
  decodeVerifiedClaims,
  type ParsedBody,
  parseActivityBody,
  readBearerToken,
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
    "the request body is not a readable JSON activity with a non-empty string serviceUrl",
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

type ValidatorClass = new (
  appId: string,
  tenantId?: string,
  serviceUrl?: string,
  logger?: undefined,
  cloud?: TeamsCloudEndpoints,
) => TokenValidatorLike;

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

/** The validator class the module exports, or a reason it cannot be had. Never throws. */
async function resolveValidatorClass(
  options: TeamsActivityVerifierOptions,
): Promise<ValidatorClass | string> {
  let mod: unknown;
  try {
    mod = await importMiddleware(options);
  } catch {
    return `could not import ${WHICH_VALIDATOR}`;
  }
  try {
    return (
      validatorClass(mod as ValidatorModuleLike | undefined) ??
      `found neither class: expected ${WHICH_VALIDATOR}`
    );
  } catch {
    return `could not read the validator classes of ${WHICH_VALIDATOR}`;
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
      undefined,
      options.cloud,
    );
    return { validator };
  } catch {
    return { unavailable: `could not construct the validator from ${WHICH_VALIDATOR}` };
  }
}

async function readBody(request: Request): Promise<ParsedBody> {
  try {
    return parseActivityBody(await request.text());
  } catch {
    return { ok: false, reason: "malformed_body" };
  }
}

/** The SDK's verdict on this exact header: the token it resolved, or `undefined` on refusal. */
async function sdkCheck(
  validator: TokenValidatorLike,
  header: string,
  activity: Record<string, unknown>,
): Promise<ResolvedToken | undefined> {
  try {
    const result = (await validator.check(header, activity)) as
      | { appId?: unknown; serviceUrl?: unknown }
      | null
      | undefined;
    const { appId, serviceUrl } = result ?? {};
    if (typeof appId !== "string" || typeof serviceUrl !== "string") return undefined;
    return { appId, serviceUrl };
  } catch {
    return undefined;
  }
}

type ReadableActivity = Extract<ParsedBody, { ok: true }>;

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
 *
 * It accepts only when the SDK validator accepted the token AND the token's `aud`, `serviceurl`
 * and tenant claims match this configuration; it never throws for a request. The SDK is imported
 * on the first request, once per verifier. A key-set outage reads as `invalid_token`, the same as
 * a forgery, and the next request retries.
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

    const token = await sdkCheck(load.validator, read.header, read.body.activity);
    return judgeVerifiedToken(token, read.rawToken, read.body, expected);
  };
}
