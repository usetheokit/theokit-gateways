/**
 * `wechatChannel` — the WeChat Official Account channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { WeChatAdapter } from "./adapter.js";
import type { WeChatAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway-wechat", {
    code: "invalid_config",
    message: `gateway-wechat: config.${key} must be ${expected}`,
    detail: key,
  });
}

/** Reads `key` as a non-empty string. */
function readString(config: Config, key: string): string {
  const value = config[key];
  if (value === undefined || value === null || value === "") {
    throw invalid(key, "a non-empty string");
  }
  if (typeof value !== "string") throw invalid(key, "a string");
  return value;
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
    description: "The token configured for server callbacks, used to verify their signature.",
  },
];

/**
 * The WeChat channel. Callbacks reach the adapter through a route your app mounts
 * (`transport: "socket"` is the constructor-only descriptor shape; the webhook contract is separate).
 *
 * `create` refuses a value of the wrong type with a `GatewayConfigurationError` coded
 * `invalid_config` and performs no network call.
 *
 * @public
 */
export const wechatChannel = {
  platform: "wechat" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): WeChatAdapter {
    const options: WeChatAdapterOptions = {
      appId: readString(config, "appId"),
      appSecret: readString(config, "appSecret"),
      token: readString(config, "token"),
    };
    return new WeChatAdapter(options);
  },
};
