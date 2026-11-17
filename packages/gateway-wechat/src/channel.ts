/**
 * `wechatChannel` — the WeChat Official Account channel described as data. Typed locally on
 * purpose: this package's peer range on `@theokit/gateway` is a floor, and a published `.d.ts`
 * must not name a core type a consumer on that floor lacks.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { WeChatAdapter } from "./adapter.js";

const PREFIX = "gateway-wechat";

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
    key: "appId",
    required: true,
    secret: false,
    env: "WECHAT_APP_ID",
    description: "The Official Account AppID.",
  },
  {
    key: "appSecret",
    required: true,
    secret: true,
    env: "WECHAT_APP_SECRET",
    description: "The Official Account AppSecret.",
  },
  {
    key: "token",
    required: true,
    secret: true,
    env: "WECHAT_TOKEN",
    description: "The server-URL verification token you chose.",
  },
];

/**
 * The WeChat channel. `create` validates every value and throws a `GatewayConfigurationError`
 * coded `invalid_config` naming the key; it performs no network call. Inbound callbacks reach the
 * adapter through `handleWebhook`, routed by the app.
 *
 * @public
 */
export const wechatChannel = {
  platform: "wechat" as const,
  transport: "socket" as const,
  config: CONFIG,
  create(config: Config): WeChatAdapter {
    return new WeChatAdapter({
      appId: readString(config, "appId"),
      appSecret: readString(config, "appSecret"),
      token: readString(config, "token"),
    });
  },
};
