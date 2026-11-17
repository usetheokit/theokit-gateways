/**
 * `yuanbaoChannel` — the Yuanbao channel described as data.
 *
 * Typed locally on purpose: this package's peer range on `@theokit/gateway` is a floor, and a
 * published `.d.ts` naming a core type that an older core lacks would break a consumer there. The
 * object is structurally a `ChannelDescriptor`.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { YuanbaoAdapter } from "./adapter.js";

const ORIGIN = "gateway-yuanbao";

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError(ORIGIN, {
    code: "invalid_config",
    message: `${ORIGIN}: config.${key} must be ${expected}`,
    detail: key,
  });
}

function readString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.length === 0) throw invalid(key, "a non-empty string");
  return value;
}

function optionalString(
  config: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, string> {
  const value = config[key];
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") throw invalid(key, "a string");
  return { [key]: value };
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly env: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "appId",
    env: "YUANBAO_APP_ID",
    required: true,
    secret: false,
    description: "The bot's app id from the Yuanbao bot console.",
  },
  {
    key: "appSecret",
    env: "YUANBAO_APP_SECRET",
    required: true,
    secret: true,
    description: "The bot's app secret; exchanged for a short-lived access token.",
  },
  {
    key: "callbackSecret",
    env: "YUANBAO_CALLBACK_SECRET",
    required: true,
    secret: true,
    description: "The callback signing secret that signs each callback request.",
  },
  {
    key: "apiBase",
    env: "YUANBAO_API_BASE",
    required: false,
    secret: false,
    description: "Override the API base, https://yuanbao.tencent.com.",
  },
];

/**
 * The Yuanbao channel.
 *
 * The adapter receives signed webhooks and opens no connection of its own, but a webhook
 * descriptor needs a `verify`/`ingest` pair that is a separate piece of work; `transport` is
 * `"socket"` until then, and the app still routes inbound requests to the adapter itself.
 *
 * `create` refuses a missing, empty or non-string value with a `GatewayConfigurationError` coded
 * `invalid_config` that names the key; it performs no network call.
 *
 * @public
 */
export const yuanbaoChannel = {
  platform: "yuanbao" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): YuanbaoAdapter {
    return new YuanbaoAdapter({
      appId: readString(config, "appId"),
      appSecret: readString(config, "appSecret"),
      callbackSecret: readString(config, "callbackSecret"),
      ...optionalString(config, "apiBase"),
    });
  },
};
