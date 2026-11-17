/**
 * `mattermostChannel` — the Mattermost channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, and the integration
 * package's typecheck is where a drift between the two fails.
 */

import { MattermostAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";

function invalid(key: string, expected: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-mattermost: config.${key} must be ${expected}`,
    detail: key,
  });
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

function readString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string") throw invalid(key, "a string");
  if (value.trim().length === 0) throw invalid(key, "a non-empty string");
  return value;
}

function readBoolean(config: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = config[key];
  if (isAbsent(value)) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw invalid(key, 'a boolean or the string "true" or "false"');
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
    const baseUrl = readString(config, "baseUrl");
    const accessToken = readString(config, "accessToken");
    const requireMention = readBoolean(config, "requireMention");
    return new MattermostAdapter({
      baseUrl,
      accessToken,
      ...(requireMention === undefined ? {} : { requireMention }),
    });
  },
};
