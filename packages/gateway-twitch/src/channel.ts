/**
 * `twitchChannel` — the Twitch channel described as data, with env bindings.
 *
 * Typed locally on purpose (as `telegramChannel` is): a published `.d.ts` naming a core type an
 * older peer lacks would break a consumer on that floor. The object is structurally a
 * `ChannelDescriptor`.
 */

import { channelConfigReaders } from "@theokit/gateway";

import { TwitchAdapter } from "./adapter.js";
import type { TwitchAdapterOptions } from "./types.js";

const PREFIX = "gateway-twitch";

type Config = Readonly<Record<string, unknown>>;

const readers = channelConfigReaders(PREFIX);
const { invalid, readString, requiredString } = readers;

/**
 * The shared readers treat `null` (and `""`) as absent. A value the caller supplied must not fall
 * back to a default silently: `null` is refused for every key, `""` for those that are not strings.
 */
function refuseSuppliedAbsent(config: Config, keys: Readonly<Record<string, string>>): void {
  for (const [key, expected] of Object.entries(keys)) {
    const value = config[key];
    if (value === null || (value === "" && expected !== "a string")) throw invalid(key, expected);
  }
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

function buildOptions(config: Config): TwitchAdapterOptions {
  refuseSuppliedAbsent(config, {
    eventSubUrl: "a string",
    fetch: "a function",
    socketFactory: "a function",
  });
  const eventSubUrl = readString(config, "eventSubUrl");
  const fetchFn = readers.readFunction<NonNullable<TwitchAdapterOptions["fetch"]>>(config, "fetch");
  const socketFactory = readers.readFunction<NonNullable<TwitchAdapterOptions["socketFactory"]>>(
    config,
    "socketFactory",
  );
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
