/**
 * `telegramChannel` — the Telegram channel described as data (FR-004 of B-018).
 *
 * Typed locally on purpose (ADR D4 of B-018): this package declares `@theokit/gateway >=0.9.0` as
 * its peer, and a published `.d.ts` naming a core type that 0.9.0 lacks would break a consumer on
 * that floor with no gate here to catch it. The object is structurally a `ChannelDescriptor`; the
 * integration package assigns it to one, and its typecheck is where a drift between the two fails.
 */

import { TelegramAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";

function invalid(key: string, expected: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-telegram: config.${key} must be ${expected}`,
    detail: key,
  });
}

function readToken(config: Readonly<Record<string, unknown>>): string {
  const token = config.token;
  if (typeof token !== "string") throw invalid("token", "a string");
  if (token.length === 0) {
    // grammy's own `new Bot("")` throws a plain Error, which `createChannels` would rethrow as a
    // defect instead of reporting the channel as rejected.
    throw new ConfigurationError({
      code: "token_required",
      message: "gateway-telegram: config.token is empty",
      detail: "token",
    });
  }
  return token;
}

function readAllowedUsers(config: Readonly<Record<string, unknown>>): string[] | undefined {
  const value = config.allowedUsers;
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) {
    throw invalid("allowedUsers", "an array of user id strings");
  }
  return value;
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally, D4). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "token",
    required: true,
    secret: true,
    description: "The bot token BotFather issued for this bot.",
  },
  {
    key: "allowedUsers",
    required: false,
    secret: false,
    description: "Telegram user ids allowed to reach the handler; absent or empty allows everyone.",
  },
];

/**
 * The Telegram channel: a long-polling bot, so it needs no webhook route.
 *
 * `create` refuses a token that is absent, empty or not a string, and an `allowedUsers` that is
 * not an array of strings, with this package's `ConfigurationError`; it performs no network call.
 *
 * @public
 */
export const telegramChannel = {
  platform: "telegram" as const,
  transport: "socket" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): TelegramAdapter {
    const token = readToken(config);
    const allowedUsers = readAllowedUsers(config);
    return new TelegramAdapter(allowedUsers === undefined ? { token } : { token, allowedUsers });
  },
};
