/**
 * `mattermostChannel` — the Mattermost channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, and the integration
 * package's typecheck is where a drift between the two fails.
 */

import { channelConfigReaders } from "@theokit/gateway";
import { MattermostAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";

const readers = channelConfigReaders(
  "gateway-mattermost",
  (options) => new ConfigurationError(options),
);
const { invalid } = readers;

/** Only `undefined` is absent: `null` and `""` are wrong shapes and throw `invalid_config`. */
const isAbsent = (value: unknown): boolean => value === undefined;

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
  optionalString: (config: Config, key: string): string | undefined =>
    isAbsent(config[key]) ? undefined : readers.requiredString(config, key),
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
    key: "baseUrl",
    required: true,
    secret: false,
    description: "Base URL of the Mattermost server, e.g. https://mattermost.example.org.",
    env: "MATTERMOST_BASE_URL",
  },
  {
    key: "accessToken",
    required: true,
    secret: true,
    description: "Personal access token or bot token.",
    env: "MATTERMOST_ACCESS_TOKEN",
  },
  {
    key: "requireMention",
    required: false,
    secret: false,
    description: "When true, channel messages reach the handler only if they mention the bot.",
    env: "MATTERMOST_REQUIRE_MENTION",
  },
];

/**
 * The Mattermost channel: a WebSocket the adapter opens itself, so it needs no webhook route.
 *
 * `create` validates each value with this package's `ConfigurationError` and makes no network call.
 *
 * @public
 */
export const mattermostChannel = {
  platform: "mattermost" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): MattermostAdapter {
    const baseUrl = read.string(config, "baseUrl");
    const accessToken = read.string(config, "accessToken");
    const requireMention = read.boolean(config, "requireMention");
    return new MattermostAdapter({
      baseUrl,
      accessToken,
      ...(requireMention === undefined ? {} : { requireMention }),
    });
  },
};
