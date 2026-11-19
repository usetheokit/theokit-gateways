/**
 * `yuanbaoChannel` — the Yuanbao channel described as data.
 *
 * Typed locally on purpose: this package's peer range on `@theokit/gateway` is a floor, and a
 * published `.d.ts` naming a core type that an older core lacks would break a consumer there. The
 * object is structurally a `ChannelDescriptor`.
 */

import {
  channelConfigReaders,
  type WebhookAnswer,
  type WebhookRequest,
} from "@theokit/gateway";

import { YuanbaoAdapter } from "./adapter.js";
import type { YuanbaoFetch } from "./types.js";

const ORIGIN = "gateway-yuanbao";

const readers = channelConfigReaders(ORIGIN);

/** Config fields, shaped like the core's `ChannelConfigField` (typed locally). */
const CONFIG = [
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
    description:
      "The bot's app secret; exchanged for a short-lived access token.",
  },
  {
    key: "callbackSecret",
    env: "YUANBAO_CALLBACK_SECRET",
    required: true,
    secret: true,
    description:
      "The callback signing secret that signs each callback request.",
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
 * Yuanbao delivers inbound events by signed webhook and the adapter opens no connection or listener of
 * its own, so `transport` is `"webhook"`. The route runs `webhook.handle`, which passes the raw body
 * and signature headers to `YuanbaoAdapter.handleWebhook` and returns its status. `webhook.verify` and
 * `webhook.ingest` are unused fail-closed stubs: the signature covers the raw body and the answer
 * may carry a body, which only `handle` can serve.
 *
 * `create` refuses a missing, empty or non-string value with a `GatewayConfigurationError` coded
 * `invalid_config` that names the key; it performs no network call.
 *
 * @public
 */
export const yuanbaoChannel = {
  platform: "yuanbao" as const,
  transport: "webhook" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): YuanbaoAdapter {
    return new YuanbaoAdapter({
      appId: readers.requiredString(config, "appId"),
      appSecret: readers.requiredString(config, "appSecret"),
      callbackSecret: readers.requiredString(config, "callbackSecret"),
      apiBase: readers.readString(config, "apiBase"),
      fetch: readers.readFunction<YuanbaoFetch>(config, "fetch"),
    });
  },
  webhook: {
    verify: () => false,
    ingest: () => Promise.resolve("malformed" as const),
    async handle(
      adapter: YuanbaoAdapter,
      request: WebhookRequest,
    ): Promise<WebhookAnswer> {
      const answer = await adapter.handleWebhook(
        request.rawBody,
        request.headers["x-signature"],
        request.headers["x-timestamp"],
      );
      return { status: answer.status };
    },
  },
};
