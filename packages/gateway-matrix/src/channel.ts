/**
 * `matrixChannel` — the Matrix channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, and the integration
 * package's typecheck is where a drift between the two fails.
 */

import { channelConfigReaders } from "@theokit/gateway";
import { MatrixAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";
import type { MatrixAdapterOptions } from "./types.js";

const readers = channelConfigReaders(
  "gateway-matrix",
  (options) => new ConfigurationError(options),
);
const { invalid, isAbsent } = readers;

type Config = Readonly<Record<string, unknown>>;

/** `configFromEnv` yields strings, so these readers also take the string forms. */
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value.trim())) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

const read = {
  string: readers.requiredString,
  optionalString: readers.readString,
  boolean(config: Config, key: string): boolean | undefined {
    const value = config[key];
    if (isAbsent(value)) return undefined;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw invalid(key, 'a boolean or the string "true" or "false"');
  },
  number(config: Config, key: string): number | undefined {
    const value = config[key];
    if (isAbsent(value)) return undefined;
    const parsed = toFiniteNumber(value);
    if (parsed !== undefined) return parsed;
    throw invalid(key, "a number or a digit string");
  },
  list(config: Config, key: string): string[] | undefined {
    const value = config[key];
    if (isAbsent(value)) return undefined;
    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
    throw invalid(key, "an array of strings or a comma-separated string");
  },
};

const readAcceptInvite = (config: Config): MatrixAdapterOptions["acceptInvite"] =>
  readers.readFunction<NonNullable<MatrixAdapterOptions["acceptInvite"]>>(config, "acceptInvite");

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
  readonly env?: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "homeserverUrl",
    required: true,
    secret: false,
    description: "Base URL of the Matrix homeserver, e.g. https://matrix.example.org.",
    env: "MATRIX_HOMESERVER_URL",
  },
  {
    key: "accessToken",
    required: true,
    secret: true,
    description: "Access token of the bot account.",
    env: "MATRIX_ACCESS_TOKEN",
  },
  {
    key: "userId",
    required: true,
    secret: false,
    description: "Matrix user id of the bot, e.g. @bot:example.org.",
    env: "MATRIX_USER_ID",
  },
  {
    key: "freshnessWindowMs",
    required: false,
    secret: false,
    description: "Events older than this many milliseconds are dropped.",
    env: "MATRIX_FRESHNESS_WINDOW_MS",
  },
  {
    key: "requireMention",
    required: false,
    secret: false,
    description: "When true, group messages reach the handler only if they mention the bot.",
    env: "MATRIX_REQUIRE_MENTION",
  },
  {
    key: "acceptInvite",
    required: false,
    secret: false,
    description: "Programmatic callback deciding whether to accept a room invite; no env binding.",
  },
];

/**
 * The Matrix channel: a sync loop the adapter opens itself, so it needs no webhook route.
 *
 * `create` validates each value with this package's `ConfigurationError` and makes no network call.
 *
 * @public
 */
export const matrixChannel = {
  platform: "matrix" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): MatrixAdapter {
    const homeserverUrl = read.string(config, "homeserverUrl");
    const accessToken = read.string(config, "accessToken");
    const userId = read.string(config, "userId");
    const freshnessWindowMs = read.number(config, "freshnessWindowMs");
    const requireMention = read.boolean(config, "requireMention");
    const acceptInvite = readAcceptInvite(config);
    return new MatrixAdapter({
      homeserverUrl,
      accessToken,
      userId,
      ...(freshnessWindowMs === undefined ? {} : { freshnessWindowMs }),
      ...(requireMention === undefined ? {} : { requireMention }),
      ...(acceptInvite === undefined ? {} : { acceptInvite }),
    });
  },
};
