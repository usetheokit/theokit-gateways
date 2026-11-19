/**
 * `xChannel` — the X (Twitter) channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { channelConfigReaders } from "@theokit/gateway";

import { XAdapter } from "./adapter.js";
import type { XAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

const { invalid, readString, requiredString } = channelConfigReaders("gateway-x");

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

const field = (
  key: string,
  env: string,
  description: string,
  { required = true, secret = false }: { required?: boolean; secret?: boolean } = {},
): ConfigField => ({ key, required, secret, env, description });

const CONFIG: ReadonlyArray<ConfigField> = [
  field("userId", "X_USER_ID", "The numeric X user id of the bot account."),
  field("username", "X_USERNAME", "The bot account's @handle, without the @."),
  field("clientId", "X_CLIENT_ID", "The OAuth 2.0 client id of the X app."),
  field("clientSecret", "X_CLIENT_SECRET", "The OAuth 2.0 client secret of the X app.", {
    secret: true,
  }),
  field("refreshToken", "X_REFRESH_TOKEN", "The OAuth 2.0 refresh token of the bot account.", {
    secret: true,
  }),
  field(
    "allowFrom",
    "X_ALLOW_FROM",
    "X user ids allowed to reach the handler, an array or a comma-separated string; must not be empty.",
  ),
  field("bearerToken", "X_BEARER_TOKEN", "An app-only bearer token for reads.", {
    required: false,
    secret: true,
  }),
  field(
    "guestDailyLimit",
    "X_GUEST_DAILY_LIMIT",
    "Replies per day for a sender outside the allowlist (guest.dailyLimit); a positive integer.",
    { required: false },
  ),
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
    const str = (key: string) => requiredString(config, key);
    // `null` is a wrong shape here, not an absent value (configFromEnv never yields it).
    if (config.bearerToken === null) throw invalid("bearerToken", "a string");
    const bearerToken = readString(config, "bearerToken");
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
