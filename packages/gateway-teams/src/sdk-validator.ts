/**
 * The Microsoft SDK token validator, as the verifier reaches it: loaded once from the SDK's
 * middleware module by an unpublished path (ADR-0003), handed a logger that writes nothing, and
 * asked for its verdict on one token. Every failure is a value, never a rejection.
 *
 * @internal
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { errorKind } from "./error-kind.js";
import {
  type Refusal,
  refuse,
  type TeamsActivityVerifierOptions,
  type TeamsCloudEndpoints,
} from "./verifier-contract.js";

/** The SDK module the validator is read from. Unpublished path: ADR-0003. */
const MIDDLEWARE_MODULE = "@microsoft/teams.apps/dist/middleware/index.js";

const WHICH_VALIDATOR = `${MIDDLEWARE_MODULE} exporting InboundActivityTokenValidator or ServiceTokenValidator`;

/** The two members of the SDK validator this verifier calls. */
export interface TokenValidatorLike {
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
export type ResolvedToken = { readonly appId: string; readonly serviceUrl: string };

export type Loaded = { readonly validator: TokenValidatorLike } | { readonly unavailable: string };

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
export async function loadValidator(options: TeamsActivityVerifierOptions): Promise<Loaded> {
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
export async function sdkCheck(
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
