/**
 * `synologyChatChannel` — the Synology Chat channel described as data, with env bindings.
 *
 * Typed locally on purpose (as `telegramChannel` is): a published `.d.ts` naming a core type an
 * older peer lacks would break a consumer on that floor. The object is structurally a
 * `ChannelDescriptor`.
 */

import { channelConfigReaders, GatewayConfigurationError } from "@theokit/gateway";

import { SynologyChatAdapter } from "./adapter.js";
import { rememberSynologyToken, synologyChatWebhook } from "./fetch-webhook.js";
import { type SynologyChatAdapterOptions, SynologyChatConfigError } from "./types.js";

const PREFIX = "gateway-synology-chat";

type Config = Readonly<Record<string, unknown>>;

const readers = channelConfigReaders(PREFIX);
const { invalid, readString, requiredString } = readers;

/** `null` is refused for every key, and `""` for each non-string key, instead of defaulting. */
const SYNOLOGY_EXPECTED: Readonly<Record<string, string>> = {
  path: "a string",
  port: "a number or a string of digits",
  connectTimeoutMs: "a number or a string of digits",
  app: "an Express app (an object with a post method)",
  fetch: "a function",
};

function refuseSynologyAbsent(config: Config): void {
  for (const key of Object.keys(SYNOLOGY_EXPECTED)) {
    const supplied = config[key];
    const emptyNonString = supplied === "" && key !== "path";
    if (supplied === null || emptyNonString) throw invalid(key, SYNOLOGY_EXPECTED[key] as string);
  }
}

/** A number, or a string of digits (what an environment variable gives). */
function readNumber(config: Config, key: string): number | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  throw invalid(key, "a number or a string of digits");
}

function readApp(config: Config): SynologyChatAdapterOptions["app"] {
  const value = config.app;
  if (value === undefined) return undefined;
  // The adapter mounts its route with `app.post(...)` in connect(); anything else fails there.
  const post = (value as { post?: unknown } | null)?.post;
  if (
    (typeof value !== "function" && (typeof value !== "object" || value === null)) ||
    typeof post !== "function"
  ) {
    throw invalid("app", "an Express app (an object with a post method)");
  }
  return value as SynologyChatAdapterOptions["app"];
}

function buildOptions(config: Config): SynologyChatAdapterOptions {
  refuseSynologyAbsent(config);
  const path = readString(config, "path");
  const port = readNumber(config, "port");
  const connectTimeoutMs = readNumber(config, "connectTimeoutMs");
  const app = readApp(config);
  const fetchFn = readers.readFunction<NonNullable<SynologyChatAdapterOptions["fetch"]>>(
    config,
    "fetch",
  );
  return {
    botToken: requiredString(config, "botToken"),
    incomingUrl: requiredString(config, "incomingUrl"),
    ...(path === undefined ? {} : { path }),
    ...(port === undefined ? {} : { port }),
    ...(app === undefined ? {} : { app }),
    ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }),
    ...(fetchFn === undefined ? {} : { fetch: fetchFn }),
  };
}

/** The fields, shaped like the core's `ChannelConfigField` (typed locally). */
const CONFIG = [
  {
    key: "botToken",
    required: true,
    secret: true,
    env: "SYNOLOGY_CHAT_BOT_TOKEN",
    description: "The token Synology Chat sends with every outgoing callback of the bot.",
  },
  {
    key: "incomingUrl",
    required: true,
    secret: false,
    env: "SYNOLOGY_CHAT_INCOMING_URL",
    description:
      "The bot's Incoming URL, which carries its own token parameter; the adapter never logs it.",
  },
  {
    key: "path",
    required: false,
    secret: false,
    env: "SYNOLOGY_CHAT_PATH",
    description: "The route the NAS posts callbacks to; default /synology-chat.",
  },
  {
    key: "port",
    required: false,
    secret: false,
    env: "SYNOLOGY_CHAT_PORT",
    description: "The port of the adapter's own listener; default 3000, ignored with app.",
  },
  {
    key: "connectTimeoutMs",
    required: false,
    secret: false,
    env: "SYNOLOGY_CHAT_CONNECT_TIMEOUT_MS",
    description: "How long connect() waits for user_list, in ms; default 10000.",
  },
  {
    key: "app",
    required: false,
    secret: false,
    description: "Programmatic only: an Express app to mount the route on instead of listening.",
  },
  {
    key: "fetch",
    required: false,
    secret: false,
    description: "Programmatic only: the fetch used to call the NAS.",
  },
];

/**
 * The Synology Chat channel: the adapter opens its own callback listener in `connect()`.
 *
 * `create` validates each value, then builds the adapter; it makes no network call. A wrongly typed
 * value, or an empty token or invalid incoming URL, throws a `GatewayConfigurationError` coded
 * `invalid_config` with the prefix `gateway-synology-chat`.
 *
 * @public
 */
export const synologyChatChannel = {
  platform: "synology_chat" as const,
  transport: "webhook" as const,
  webhook: synologyChatWebhook,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): SynologyChatAdapter {
    const options = buildOptions(config);
    try {
      const adapter = new SynologyChatAdapter(options);
      rememberSynologyToken(adapter, options.botToken);
      return adapter;
    } catch (err) {
      if (!(err instanceof SynologyChatConfigError)) throw err;
      const key = options.botToken.length === 0 ? "botToken" : "incomingUrl";
      throw new GatewayConfigurationError(PREFIX, {
        code: "invalid_config",
        message: `${PREFIX}: config.${key} is invalid: ${err.message}`,
        detail: key,
      });
    }
  },
};
