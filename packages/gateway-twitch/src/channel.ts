/**
 * `twitchChannel` — the Twitch channel described as data, with env bindings.
 *
 * Typed locally on purpose (as `telegramChannel` is): a published `.d.ts` naming a core type an
 * older peer lacks would break a consumer on that floor. The object is structurally a
 * `ChannelDescriptor`.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { TwitchAdapter } from "./adapter.js";
import type { TwitchAdapterOptions } from "./types.js";

const PREFIX = "gateway-twitch";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string, code = "invalid_config") {
  return new GatewayConfigurationError(PREFIX, {
    code,
    message: `${PREFIX}: config.${key} must be ${expected}`,
    detail: key,
  });
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === "";
}

function readString(config: Config, key: string): string | undefined {
  const value = config[key];
  if (isAbsent(value)) return undefined;
  if (typeof value !== "string") throw invalid(key, "a string");
  return value;
}

function requiredString(config: Config, key: string): string {
  const value = readString(config, key);
  if (value === undefined) throw invalid(key, "a string");
  return value;
}

/** An array of strings, or a comma-separated string (what an environment variable gives). */
function readIds(config: Config, key: string): string[] {
  const value = config[key];
  let ids: unknown[] | undefined;
  if (typeof value === "string") {
    ids = value.split(",").map((id) => id.trim());
  } else if (Array.isArray(value)) {
    ids = value;
  }
  if (ids === undefined || !ids.every((id) => typeof id === "string")) {
    throw invalid(key, "an array of user id strings or a comma-separated string");
  }
  const list = (ids as string[]).filter((id) => id !== "");
  if (list.length === 0 || !list.every((id) => /^\d+$/.test(id))) {
    throw invalid(key, "at least one numeric user id");
  }
  return list;
}

function readSocketFactory(config: Config): TwitchAdapterOptions["socketFactory"] {
  const value = config.socketFactory;
  if (isAbsent(value)) return undefined;
  if (typeof value !== "function") throw invalid("socketFactory", "a function");
  return value as TwitchAdapterOptions["socketFactory"];
}

function readFetch(config: Config): TwitchAdapterOptions["fetch"] {
  const value = config.fetch;
  if (isAbsent(value)) return undefined;
  if (typeof value !== "function") throw invalid("fetch", "a function");
  return value as TwitchAdapterOptions["fetch"];
}

function buildOptions(config: Config): TwitchAdapterOptions {
  const eventSubUrl = readString(config, "eventSubUrl");
  const fetchFn = readFetch(config);
  const socketFactory = readSocketFactory(config);
  return {
    accessToken: requiredString(config, "accessToken"),
    botUserId: requiredString(config, "botUserId"),
    broadcasterUserIds: readIds(config, "broadcasterUserIds"),
    ...(eventSubUrl === undefined ? {} : { eventSubUrl }),
    ...(fetchFn === undefined ? {} : { fetch: fetchFn }),
    ...(socketFactory === undefined ? {} : { socketFactory }),
  };
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
    key: "accessToken",
    required: true,
    secret: true,
    env: "TWITCH_ACCESS_TOKEN",
    description:
      "The bot account's user access token, with the user:read:chat and user:write:chat scopes.",
  },
  {
    key: "botUserId",
    required: true,
    secret: false,
    env: "TWITCH_BOT_USER_ID",
    description: "The bot account's numeric user id; it must be the token's own.",
  },
  {
    key: "broadcasterUserIds",
    required: true,
    secret: false,
    env: "TWITCH_BROADCASTER_USER_IDS",
    description:
      "Numeric user ids of the channels whose chat the bot reads: an array or a comma-separated string.",
  },
  {
    key: "eventSubUrl",
    required: false,
    secret: false,
    env: "TWITCH_EVENT_SUB_URL",
    description: "The EventSub WebSocket URL; default wss://eventsub.wss.twitch.tv/ws.",
  },
  {
    key: "fetch",
    required: false,
    secret: false,
    description: "Programmatic only: the fetch used for the token validator and Helix.",
  },
  {
    key: "socketFactory",
    required: false,
    secret: false,
    description: "Programmatic only: opens an EventSub socket.",
  },
];

/**
 * The Twitch channel: the adapter opens its own EventSub WebSocket in `connect()`.
 *
 * `create` validates each value, then builds the adapter; it makes no network call. A wrongly typed
 * value throws a `GatewayConfigurationError` coded `invalid_config` with the prefix
 * `gateway-twitch`. `broadcasterUserIds` may be an array or a comma-separated string.
 *
 * @public
 */
export const twitchChannel = {
  platform: "twitch" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): TwitchAdapter {
    return new TwitchAdapter(buildOptions(config));
  },
};
