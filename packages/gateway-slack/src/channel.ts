/**
 * `slackChannel` — the Slack channel described as data.
 *
 * Typed locally on purpose (ADR D4 of B-018): a published `.d.ts` naming a core type an older
 * `@theokit/gateway` lacks would break a consumer on that floor. The object is structurally a
 * `ChannelDescriptor`; the integration package assigns it to one.
 */

import { GatewayConfigurationError } from "@theokit/gateway";
import { SlackAdapter, type SlackAdapterOptions } from "./adapter.js";

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway-slack", {
    code: "invalid_config",
    message: `gateway-slack: config.${key} must be ${expected}`,
    detail: key,
  });
}

const isAbsent = (value: unknown): boolean => value === undefined || value === null || value === "";

function readString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string") throw invalid(key, "a string");
  return value;
}

function readBoolean(config: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = config[key];
  if (isAbsent(value)) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw invalid(key, 'a boolean or the string "true" or "false"');
}

function readTransport(config: Readonly<Record<string, unknown>>): "socket" | undefined {
  const value = config.transport;
  if (isAbsent(value)) return undefined;
  if (value !== "socket") throw invalid("transport", 'the string "socket"');
  return "socket";
}

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

function readLogLevel(
  config: Readonly<Record<string, unknown>>,
): SlackAdapterOptions["logLevel"] | undefined {
  const value = config.logLevel;
  if (isAbsent(value)) return undefined;
  const level = LOG_LEVELS.find((candidate) => candidate === value);
  if (level === undefined) throw invalid("logLevel", "one of debug, info, warn, error");
  return level;
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly env?: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "botToken",
    env: "SLACK_BOT_TOKEN",
    required: true,
    secret: true,
    description: "The bot user's OAuth token, beginning xoxb-.",
  },
  {
    key: "appToken",
    env: "SLACK_APP_TOKEN",
    required: true,
    secret: true,
    description: "The app-level token for Socket Mode, beginning xapp-.",
  },
  {
    key: "transport",
    env: "SLACK_TRANSPORT",
    required: false,
    secret: false,
    description: 'The transport; only "socket" is supported.',
  },
  {
    key: "requireMention",
    env: "SLACK_REQUIRE_MENTION",
    required: false,
    secret: false,
    description: "Drop public-channel messages that do not mention the bot. Default true.",
  },
  {
    key: "logLevel",
    env: "SLACK_LOG_LEVEL",
    required: false,
    secret: false,
    description: "Bolt log level: debug, info, warn or error.",
  },
];

/**
 * The Slack channel: Socket Mode, so the adapter opens its own connection in `connect()`.
 *
 * `create` refuses a value of the wrong type with `GatewayConfigurationError` (`invalid_config`,
 * naming the key); it performs no network call.
 *
 * @public
 */
export const slackChannel = {
  platform: "slack" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): SlackAdapter {
    const botToken = readString(config, "botToken");
    const appToken = readString(config, "appToken");
    const transport = readTransport(config);
    const requireMention = readBoolean(config, "requireMention");
    const logLevel = readLogLevel(config);
    return new SlackAdapter({
      botToken,
      appToken,
      ...(transport === undefined ? {} : { transport }),
      ...(requireMention === undefined ? {} : { requireMention }),
      ...(logLevel === undefined ? {} : { logLevel }),
    });
  },
};
