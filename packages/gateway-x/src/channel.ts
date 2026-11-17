/**
 * `xChannel` — the X channel described as data. Typed locally on purpose: this package's peer
 * range on `@theokit/gateway` is a floor, and a published `.d.ts` must not name a core type a
 * consumer on that floor lacks. The object is structurally a `ChannelDescriptor`.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { XAdapter } from "./adapter.js";
import type { XAdapterOptions } from "./types.js";

const PREFIX = "gateway-x";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError(PREFIX, {
    code: "invalid_config",
    message: `${PREFIX}: config.${key} must be ${expected}`,
    detail: key,
  });
}

function readString(config: Config, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.length === 0) throw invalid(key, "a non-empty string");
  return value;
}

function readOptionalString(config: Config, key: string): string | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
  return readString(config, key);
}

/** A list as an array of strings or a comma-separated string; it must not be empty. */
function readList(config: Config, key: string): string[] {
  const value = config[key];
  let items: unknown[];
  if (typeof value === "string") items = value.split(",").map((item) => item.trim());
  else if (Array.isArray(value)) items = value;
  else throw invalid(key, "an array of strings or a comma-separated string");
  if (!items.every((item) => typeof item === "string")) {
    throw invalid(key, "an array of strings or a comma-separated string");
  }
  const list = (items as string[]).filter((item) => item.length > 0);
  if (list.length === 0) throw invalid(key, "a non-empty list (an empty list answers nobody)");
  return list;
}

function readOptionalPositiveInteger(config: Config, key: string): number | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw invalid(key, "a positive integer");
  return parsed;
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
  readonly env: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "userId",
    required: true,
    secret: false,
    env: "X_USER_ID",
    description: "The bot account's numeric user id.",
  },
  {
    key: "username",
    required: true,
    secret: false,
    env: "X_USERNAME",
    description: "The bot account's handle, with or without the @.",
  },
  {
    key: "clientId",
    required: true,
    secret: false,
    env: "X_CLIENT_ID",
    description: "The OAuth 2.0 client id of the X developer app.",
  },
  {
    key: "clientSecret",
    required: true,
    secret: true,
    env: "X_CLIENT_SECRET",
    description: "The OAuth 2.0 client secret of the app.",
  },
  {
    key: "refreshToken",
    required: true,
    secret: true,
    env: "X_REFRESH_TOKEN",
    description: "A refresh token of the bot account.",
  },
  {
    key: "allowFrom",
    required: true,
    secret: false,
    env: "X_ALLOW_FROM",
    description:
      "Handles or user ids whose mentions are answered, as a list or a comma-separated string; must not be empty.",
  },
  {
    key: "bearerToken",
    required: false,
    secret: true,
    env: "X_BEARER_TOKEN",
    description: "An app-only bearer token used to read mentions.",
  },
  {
    key: "guestDailyLimit",
    required: false,
    secret: false,
    env: "X_GUEST_DAILY_LIMIT",
    description:
      "Positive integer: mentions answered per UTC day for authors not in allowFrom. Guests are refused when absent.",
  },
];

/**
 * The X channel: it polls for mentions, so it needs no webhook route.
 *
 * `create` validates every value and throws a `GatewayConfigurationError` coded `invalid_config`
 * naming the key; it performs no network call.
 *
 * @public
 */
export const xChannel = {
  platform: "x" as const,
  transport: "socket" as const,
  config: CONFIG,
  create(config: Config): XAdapter {
    const bearerToken = readOptionalString(config, "bearerToken");
    const guestDailyLimit = readOptionalPositiveInteger(config, "guestDailyLimit");
    const options: XAdapterOptions = {
      userId: readString(config, "userId"),
      username: readString(config, "username"),
      clientId: readString(config, "clientId"),
      clientSecret: readString(config, "clientSecret"),
      refreshToken: readString(config, "refreshToken"),
      allowFrom: readList(config, "allowFrom"),
      ...(bearerToken === undefined ? {} : { bearerToken }),
      ...(guestDailyLimit === undefined ? {} : { guest: { dailyLimit: guestDailyLimit } }),
    };
    return new XAdapter(options);
  },
};
