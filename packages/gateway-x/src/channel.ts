/**
 * `xChannel` — the X (Twitter) channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { XAdapter } from "./adapter.js";
import type { XAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway-x", {
    code: "invalid_config",
    message: `gateway-x: config.${key} must be ${expected}`,
    detail: key,
  });
}

/** Reads `key` as a string; `""`, `null` and `undefined` count as absent. */
function readString(config: Config, key: string, required: boolean): string | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw invalid(key, "a non-empty string");
    return undefined;
  }
  if (typeof value !== "string") throw invalid(key, "a string");
  return value;
}

/** An array of strings or a comma-separated string; an entry that is empty once trimmed and stripped of a leading @, or an empty list, is refused. */
function readAllowFrom(config: Config): string[] {
  const value = config.allowFrom;
  const expected = "a non-empty array of user id strings or a comma-separated string of user ids";
  const ids =
    typeof value === "string" ? value.split(",").map((id) => id.trim()) : (value as unknown);
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id) => typeof id === "string" && id.trim().replace(/^@/, "").trim().length > 0)
  ) {
    throw invalid("allowFrom", expected);
  }
  return ids as string[];
}

function readLimit(config: Config): number | undefined {
  const value = config.guestDailyLimit;
  if (value === undefined) return undefined;
  const expected = "a positive integer or a string of digits";
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw invalid("guestDailyLimit", expected);
  return n;
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
    key: "userId",
    required: true,
    secret: false,
    env: "X_USER_ID",
    description: "The numeric X user id of the bot account.",
  },
  {
    key: "username",
    required: true,
    secret: false,
    env: "X_USERNAME",
    description: "The bot account's @handle, without the @.",
  },
  {
    key: "clientId",
    required: true,
    secret: false,
    env: "X_CLIENT_ID",
    description: "The OAuth 2.0 client id of the X app.",
  },
  {
    key: "clientSecret",
    required: true,
    secret: true,
    env: "X_CLIENT_SECRET",
    description: "The OAuth 2.0 client secret of the X app.",
  },
  {
    key: "refreshToken",
    required: true,
    secret: true,
    env: "X_REFRESH_TOKEN",
    description: "The OAuth 2.0 refresh token of the bot account.",
  },
  {
    key: "allowFrom",
    required: true,
    secret: false,
    env: "X_ALLOW_FROM",
    description:
      "X user ids allowed to reach the handler, an array or a comma-separated string; must not be empty.",
  },
  {
    key: "bearerToken",
    required: false,
    secret: true,
    env: "X_BEARER_TOKEN",
    description: "An app-only bearer token for reads.",
  },
  {
    key: "guestDailyLimit",
    required: false,
    secret: false,
    env: "X_GUEST_DAILY_LIMIT",
    description:
      "Replies per day for a sender outside the allowlist (guest.dailyLimit); a positive integer.",
  },
];

/**
 * The X channel: the adapter polls mentions once `connect()` runs, so it needs no webhook route.
 *
 * `create` refuses a value of the wrong type, and an empty `allowFrom`, with a
 * `GatewayConfigurationError` coded `invalid_config`; it performs no network call.
 *
 * @public
 */
export const xChannel = {
  platform: "x" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): XAdapter {
    const str = (key: string) => readString(config, key, true) as string;
    const bearerToken = readString(config, "bearerToken", false);
    const guestDailyLimit = readLimit(config);
    const options: XAdapterOptions = {
      userId: str("userId"),
      username: str("username"),
      clientId: str("clientId"),
      clientSecret: str("clientSecret"),
      refreshToken: str("refreshToken"),
      allowFrom: readAllowFrom(config),
      ...(bearerToken === undefined ? {} : { bearerToken }),
      ...(guestDailyLimit === undefined ? {} : { guest: { dailyLimit: guestDailyLimit } }),
    };
    return new XAdapter(options);
  },
};
