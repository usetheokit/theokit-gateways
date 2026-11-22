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
  // `configFromEnv` yields strings, so a comma-separated string is accepted next to an array.
  // An empty element (a stray or trailing comma, a blank string) is refused: an empty list means
  // "allow everyone", so a malformed allowlist must not collapse into one.
  const expected = "an array of user id strings or a comma-separated string of user ids";
  const ids =
    typeof value === "string" ? value.split(",").map((id) => id.trim()) : (value as unknown);
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && id.length > 0)) {
    throw invalid("allowedUsers", expected);
  }
  return ids;
}

function readRequireMention(config: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = config.requireMention;
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  if (typeof value !== "boolean") throw invalid("requireMention", "a boolean");
  return value;
}

function readApiBase(config: Readonly<Record<string, unknown>>): string | undefined {
  const value = config.apiBase;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0)
    throw invalid("apiBase", "a non-empty URL string");
  return value;
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally, D4). */
interface ConfigField {
  readonly key: string;
  readonly env?: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "token",
    env: "TELEGRAM_TOKEN",
    required: true,
    secret: true,
    description: "The bot token BotFather issued for this bot.",
  },
  {
    key: "allowedUsers",
    env: "TELEGRAM_ALLOWED_USERS",
    required: false,
    secret: false,
    description: "Telegram user ids allowed to reach the handler; absent or empty allows everyone.",
  },
  {
    key: "apiBase",
    env: "TELEGRAM_API_BASE",
    required: false,
    secret: false,
    description:
      "Bot API root, for a self-hosted Bot API server; default https://api.telegram.org.",
  },
  {
    key: "requireMention",
    required: false,
    secret: false,
    description:
      "When true, group messages reach the handler only if they mention the bot, reply to it or are slash commands; default false.",
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
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): TelegramAdapter {
    const token = readToken(config);
    const allowedUsers = readAllowedUsers(config);
    const requireMention = readRequireMention(config);
    const apiBase = readApiBase(config);
    return new TelegramAdapter({
      token,
      ...(apiBase === undefined ? {} : { apiBase }),
      ...(allowedUsers === undefined ? {} : { allowedUsers }),
      ...(requireMention === undefined ? {} : { requireMention }),
    });
  },
};
