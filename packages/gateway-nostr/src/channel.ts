/**
 * The Nostr channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type a consumer's floor lacks would break that consumer. The object is
 * structurally a `ChannelDescriptor`.
 *
 * `configFromEnv` yields strings, so `create` accepts a list as an array or a comma-separated
 * string, a boolean as a boolean or `"true"`/`"false"`, and a number as a number or a digit string.
 */

import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

import { NostrAdapter } from "./adapter.js";
import { NostrKeyError } from "./keys.js";
import { NostrRelayError } from "./relay-client.js";
import type { NostrAdapterOptions } from "./types.js";

/** Misconfiguration of the Nostr channel, raised before any network call. */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: GatewayConfigurationErrorOptions) {
    super("gateway-nostr", opts);
  }
}

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-nostr: config.${key} must be ${expected}`,
    detail: key,
  });
}

function absent(value: unknown): boolean {
  return value === undefined;
}

function readString(config: Config, key: string): string | undefined {
  const value = config[key];
  if (absent(value)) return undefined;
  if (typeof value !== "string") throw invalid(key, "a string");
  return value;
}

function readRequiredString(config: Config, key: string): string {
  const value = readString(config, key);
  if (value === undefined) throw invalid(key, "a string");
  return value;
}

function readList(config: Config, key: string): string[] | undefined {
  const value = config[key];
  if (absent(value)) return undefined;
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw invalid(key, "an array of strings or a comma-separated string");
  }
  return value;
}

function readNumber(config: Config, key: string): number | undefined {
  const value = config[key];
  if (absent(value)) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  throw invalid(key, "a number or a digit string");
}

function readFunction(config: Config, key: string): ((...args: never[]) => unknown) | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "function") throw invalid(key, "a function");
  return value as (...args: never[]) => unknown;
}

function readClient(config: Config): NostrAdapterOptions["client"] {
  const value = config.client;
  if (value === undefined) return undefined;
  const methods = ["open", "subscribe", "publish", "close"];
  if (
    typeof value !== "object" ||
    value === null ||
    !methods.every((m) => typeof (value as Record<string, unknown>)[m] === "function")
  ) {
    throw invalid("client", "an object with open, subscribe, publish and close functions");
  }
  return value as NostrAdapterOptions["client"];
}

/** Keep only the keys whose value is defined. */
function defined<T extends object>(options: T): T {
  return Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) as T;
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly env?: string;
  readonly description: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "secretKey",
    required: true,
    secret: true,
    env: "NOSTR_SECRET_KEY",
    description: "The bot's secret key, an nsec1 key or 64 hex characters.",
  },
  {
    key: "relays",
    required: true,
    secret: false,
    env: "NOSTR_RELAYS",
    description: "Relay URLs, each wss: (or ws:): an array or a comma-separated string.",
  },
  {
    key: "ignoreBefore",
    required: false,
    secret: false,
    env: "NOSTR_IGNORE_BEFORE",
    description:
      "Unix seconds before which a direct message is not answered; default the time of construction.",
  },
  {
    key: "socketFactory",
    required: false,
    secret: false,
    description: "Programmatic only, no env binding: a function that opens a relay socket.",
  },
  {
    key: "client",
    required: false,
    secret: false,
    description:
      "Programmatic only, no env binding: a relay client (open, subscribe, publish, close).",
  },
];

/**
 * The Nostr channel: the adapter opens its own relay sockets in `connect()`, so it needs no
 * webhook route. `create` validates each value and makes no network call; `socketFactory` and
 * `client` are programmatic fields with no env binding.
 *
 * @public
 */
export const nostrChannel = {
  platform: "nostr" as const,
  transport: "socket" as const,
  config: CONFIG,
  create(config: Config): NostrAdapter {
    const relays = readList(config, "relays");
    if (relays === undefined)
      throw invalid("relays", "an array of strings or a comma-separated string");
    const options: NostrAdapterOptions = defined({
      secretKey: readRequiredString(config, "secretKey"),
      relays,
      ignoreBefore: readNumber(config, "ignoreBefore"),
      socketFactory: readFunction(config, "socketFactory") as NostrAdapterOptions["socketFactory"],
      client: readClient(config),
    });
    try {
      return new NostrAdapter(options);
    } catch (err) {
      // The messages of both errors never carry the key.
      if (err instanceof NostrKeyError)
        throw invalid("secretKey", "an nsec1 key or 64 hex characters");
      if (err instanceof NostrRelayError)
        throw invalid("relays", "a non-empty list of ws: or wss: URLs");
      throw err;
    }
  },
};
