/**
 * `wechatChannel` — the WeChat Official Account channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { channelConfigReaders } from "@theokit/gateway";

import { type ConfigField, field } from "../../../shared/channel-config-field.js";
import { WeChatAdapter } from "./adapter.js";
import type { WeChatAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

const { requiredString } = channelConfigReaders("gateway-wechat");

const CONFIG: ReadonlyArray<ConfigField> = [
  field("appId", "WECHAT_APP_ID", "The Official Account AppID."),
  field("appSecret", "WECHAT_APP_SECRET", "The Official Account AppSecret.", { secret: true }),
  field(
    "token",
    "WECHAT_TOKEN",
    "The token configured for server callbacks, used to verify their signature.",
    { secret: true },
  ),
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
      appId: requiredString(config, "appId"),
      appSecret: requiredString(config, "appSecret"),
      token: requiredString(config, "token"),
    };
    return new WeChatAdapter(options);
  },
};
