/**
 * `matrixChannel` — the Matrix channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, and the integration
 * package's typecheck is where a drift between the two fails.
 */

import { channelConfigReaders } from "@theokit/gateway";
import { type ConfigField, field } from "../../../shared/channel-config-field.js";
import { envValueReaders } from "../../../shared/env-value-readers.js";
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

/** Readers for values that may arrive as env strings; only `undefined` is absent. */
const read = {
  ...envValueReaders(invalid),
  string: readers.requiredString,
};

function readAcceptInvite(
  config: Readonly<Record<string, unknown>>,
): MatrixAdapterOptions["acceptInvite"] {
  const value = config.acceptInvite;
  if (isAbsent(value)) return undefined;
  if (typeof value !== "function") throw invalid("acceptInvite", "a function");
  return value as MatrixAdapterOptions["acceptInvite"];
}

const CONFIG: ReadonlyArray<ConfigField> = [
  field(
    "homeserverUrl",
    "MATRIX_HOMESERVER_URL",
    "Base URL of the Matrix homeserver, e.g. https://matrix.example.org.",
  ),
  field("accessToken", "MATRIX_ACCESS_TOKEN", "Access token of the bot account.", { secret: true }),
  field("userId", "MATRIX_USER_ID", "Matrix user id of the bot, e.g. @bot:example.org."),
  field(
    "freshnessWindowMs",
    "MATRIX_FRESHNESS_WINDOW_MS",
    "Events older than this many milliseconds are dropped.",
    { required: false },
  ),
  field(
    "requireMention",
    "MATRIX_REQUIRE_MENTION",
    "When true, group messages reach the handler only if they mention the bot.",
    { required: false },
  ),
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
