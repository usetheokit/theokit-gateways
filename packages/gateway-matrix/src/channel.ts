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
const { invalid } = readers;

/** Only `undefined` is absent: `null` and `""` are wrong shapes and throw `invalid_config`. */
const isAbsent = (value: unknown): boolean => value === undefined;

const read = {
  string: readers.requiredString,
  optionalString: readers.readStrictString,
  boolean: readers.readFlag,
  number: readers.readNumber,
  list: readers.readList,
};

function readAcceptInvite(
  config: Readonly<Record<string, unknown>>,
): MatrixAdapterOptions["acceptInvite"] {
  const value = config.acceptInvite;
  if (isAbsent(value)) return undefined;
  if (typeof value !== "function") throw invalid("acceptInvite", "a function");
  return value as MatrixAdapterOptions["acceptInvite"];
}

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
