/**
 * `synologyChatChannel` — the Synology Chat channel described as data, with env bindings.
 *
 * Typed locally on purpose (as `telegramChannel` is): a published `.d.ts` naming a core type an
 * older peer lacks would break a consumer on that floor. The object is structurally a
 * `ChannelDescriptor`.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { SynologyChatAdapter } from "./adapter.js";
import { type SynologyChatAdapterOptions, SynologyChatConfigError } from "./types.js";

const PREFIX = "gateway-synology-chat";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError(PREFIX, {
    code: "invalid_config",
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

/** A number, or a string of digits (what an environment variable gives). */
function readNumber(config: Config, key: string): number | undefined {
  const value = config[key];
  if (isAbsent(value)) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  throw invalid(key, "a number or a string of digits");
}

function readApp(config: Config): SynologyChatAdapterOptions["app"] {
  const value = config.app;
  if (isAbsent(value)) return undefined;
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

function readFetch(config: Config): SynologyChatAdapterOptions["fetch"] {
  const value = config.fetch;
  if (isAbsent(value)) return undefined;
  if (typeof value !== "function") throw invalid("fetch", "a function");
  return value as SynologyChatAdapterOptions["fetch"];
}

function buildOptions(config: Config): SynologyChatAdapterOptions {
  const path = readString(config, "path");
  const port = readNumber(config, "port");
  const connectTimeoutMs = readNumber(config, "connectTimeoutMs");
  const app = readApp(config);
  const fetchFn = readFetch(config);
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
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): SynologyChatAdapter {
    const options = buildOptions(config);
    try {
      return new SynologyChatAdapter(options);
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
