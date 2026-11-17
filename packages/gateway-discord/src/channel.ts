/**
 * `discordChannel` — the Discord channel described as data.
 *
 * Typed locally on purpose (ADR D4 of B-018): a published `.d.ts` naming a core type an older
 * `@theokit/gateway` lacks would break a consumer on that floor. The object is structurally a
 * `ChannelDescriptor`; the integration package assigns it to one.
 */

import { GatewayConfigurationError } from "@theokit/gateway";
import type { GatewayIntentBits } from "discord.js";
import { DiscordAdapter, type DiscordAdapterOptions } from "./adapter.js";

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway-discord", {
    code: "invalid_config",
    message: `gateway-discord: config.${key} must be ${expected}`,
    detail: key,
  });
}

const isAbsent = (value: unknown): boolean => value === undefined || value === null || value === "";

function readToken(config: Readonly<Record<string, unknown>>): string {
  const token = config.token;
  if (typeof token !== "string") throw invalid("token", "a string");
  if (token.length === 0) {
    throw new GatewayConfigurationError("gateway-discord", {
      code: "token_required",
      message: "gateway-discord: config.token is empty",
      detail: "token",
    });
  }
  return token;
}

function readBoolean(config: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
  const value = config[key];
  if (isAbsent(value)) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw invalid(key, 'a boolean or the string "true" or "false"');
}

function toIntent(item: unknown): number | undefined {
  if (typeof item === "number" && Number.isInteger(item) && item >= 0) return item;
  if (typeof item === "string" && /^\d+$/.test(item.trim())) return Number(item.trim());
  return undefined;
}

function readIntents(config: Readonly<Record<string, unknown>>): GatewayIntentBits[] | undefined {
  const value = config.intents;
  if (value === undefined || value === null) return undefined;
  const expected = "an array of intent numbers or a comma-separated string of digits";
  const items: unknown[] | undefined =
    typeof value === "string"
      ? value
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      : Array.isArray(value)
        ? value
        : undefined;
  if (items === undefined) throw invalid("intents", expected);
  const intents = items.map(toIntent);
  if (intents.some((intent) => intent === undefined)) throw invalid("intents", expected);
  return intents as GatewayIntentBits[];
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
    key: "token",
    env: "DISCORD_TOKEN",
    required: true,
    secret: true,
    description: "The bot token from the Discord Developer Portal (Bot tab).",
  },
  {
    key: "intents",
    env: "DISCORD_INTENTS",
    required: false,
    secret: false,
    description:
      "Gateway intent bit values, as an array or comma-separated digits; absent uses the adapter default (message content included).",
  },
  {
    key: "requireMention",
    env: "DISCORD_REQUIRE_MENTION",
    required: false,
    secret: false,
    description: "Deliver a guild message only when it mentions the bot. Default true.",
  },
];

/**
 * The Discord channel: the bot opens its own websocket in `connect()`, so it needs no webhook.
 *
 * `create` refuses a value of the wrong type with `GatewayConfigurationError` (`invalid_config`,
 * naming the key); it performs no network call.
 *
 * @public
 */
export const discordChannel = {
  platform: "discord" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): DiscordAdapter {
    const token = readToken(config);
    const intents = readIntents(config);
    const requireMention = readBoolean(config, "requireMention");
    const options: DiscordAdapterOptions = {
      token,
      ...(intents === undefined ? {} : { intents }),
      ...(requireMention === undefined ? {} : { requireMention }),
    };
    return new DiscordAdapter(options);
  },
};
