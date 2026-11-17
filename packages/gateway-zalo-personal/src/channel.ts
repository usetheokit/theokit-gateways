/**
 * `zaloPersonalChannel` — the Zalo personal channel described as data, with env bindings.
 *
 * Typed locally on purpose (as `telegramChannel` is): a published `.d.ts` naming a core type an
 * older peer lacks would break a consumer on that floor. The object is structurally a
 * `ChannelDescriptor`.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { ZaloPersonalAdapter } from "./adapter.js";
import type { ZaloCredentials, ZaloPersonalAdapterOptions } from "./types.js";

const PREFIX = "gateway-zalo-personal";

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

const EXPECTED_CREDENTIALS = "an object with a cookie, an imei and a userAgent, or its JSON text";

/** The credentials as an object, or the JSON text of one (what an environment variable gives). */
function readCredentials(config: Config): ZaloCredentials {
  let value = config.credentials;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw invalid("credentials", "valid JSON text of the web session");
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("credentials", EXPECTED_CREDENTIALS);
  }
  const c = value as Record<string, unknown>;
  const { cookie, imei, userAgent } = c;
  if (
    cookie === undefined ||
    cookie === null ||
    typeof imei !== "string" ||
    imei === "" ||
    typeof userAgent !== "string" ||
    userAgent === ""
  ) {
    throw invalid("credentials", EXPECTED_CREDENTIALS);
  }
  return { cookie, imei, userAgent };
}

function buildOptions(config: Config): ZaloPersonalAdapterOptions {
  const login = config.login;
  if (!isAbsent(login) && typeof login !== "function") throw invalid("login", "a function");
  return {
    credentials: readCredentials(config),
    ...(isAbsent(login) ? {} : { login: login as ZaloPersonalAdapterOptions["login"] }),
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
    key: "credentials",
    required: true,
    secret: true,
    env: "ZALO_PERSONAL_CREDENTIALS",
    description:
      "The account's web session ({ cookie, imei, userAgent }): an object, or its JSON text.",
  },
  {
    key: "login",
    required: false,
    secret: false,
    description: "Programmatic only: replaces the zca-js login.",
  },
];

/**
 * The Zalo personal channel: the adapter opens its own listener in `connect()`.
 *
 * `create` validates each value, then builds the adapter; it makes no network call. A wrongly typed
 * value or credentials that are not valid JSON throw a `GatewayConfigurationError` coded
 * `invalid_config` with the prefix `gateway-zalo-personal`.
 *
 * @public
 */
export const zaloPersonalChannel = {
  platform: "zalo_personal" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): ZaloPersonalAdapter {
    return new ZaloPersonalAdapter(buildOptions(config));
  },
};
