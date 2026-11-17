/**
 * `tlonUrbitChannel` — the Tlon (Urbit) channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` naming a core type must not break a consumer on an older peer floor.
 */

import { TlonUrbitAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";

function invalid(key: string, expected: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-tlon-urbit: config.${key} must be ${expected}`,
    detail: key,
  });
}

function readString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(key, "a non-empty string");
  }
  return value;
}

function readTimeout(config: Readonly<Record<string, unknown>>): number | undefined {
  const value = config.connectTimeoutMs;
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim()) && Number(value) > 0) {
    return Number(value.trim());
  }
  throw invalid("connectTimeoutMs", "a positive number or a digit string");
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly env: string;
  readonly description: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "shipUrl",
    required: true,
    secret: false,
    env: "TLON_URBIT_SHIP_URL",
    description: "The ship's HTTP base URL, for example https://bot.tlon.network.",
  },
  {
    key: "ship",
    required: true,
    secret: false,
    env: "TLON_URBIT_SHIP",
    description: "The bot's ship name, ~sampel-palnet.",
  },
  {
    key: "code",
    required: true,
    secret: true,
    env: "TLON_URBIT_CODE",
    description: "The ship's web login code (+code).",
  },
  {
    key: "connectTimeoutMs",
    required: false,
    secret: false,
    env: "TLON_URBIT_CONNECT_TIMEOUT_MS",
    description: "How long connect() waits for login and subscription; default 10000 ms.",
  },
];

/**
 * The Tlon (Urbit) channel: the adapter opens its own subscription in `connect()`.
 *
 * `create` validates each value with this package's `ConfigurationError` and makes no network call.
 *
 * @public
 */
export const tlonUrbitChannel = {
  platform: "tlon_urbit" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): TlonUrbitAdapter {
    const shipUrl = readString(config, "shipUrl");
    const ship = readString(config, "ship");
    const code = readString(config, "code");
    const connectTimeoutMs = readTimeout(config);
    return new TlonUrbitAdapter({
      shipUrl,
      ship,
      code,
      ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }),
    });
  },
};
