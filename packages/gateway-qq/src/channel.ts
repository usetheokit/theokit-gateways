/**
 * `qqChannel` — the QQ channel described as data.
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

import { QQAdapter } from "./adapter.js";
import type { QQFetch } from "./types.js";

const ORIGIN = "gateway-qq";

const readers = channelConfigReaders(ORIGIN);

/** Config fields, shaped like the core's `ChannelConfigField` (typed locally). */
const CONFIG = [
  {
    key: "appId",
    env: "QQ_APP_ID",
    required: true,
    secret: false,
    description: "The bot's AppID from q.qq.com.",
  },
  {
    key: "appSecret",
    env: "QQ_APP_SECRET",
    required: true,
    secret: true,
    description:
      "The bot's AppSecret; exchanged for an access token and the seed of the webhook signing key.",
  },
  {
    key: "apiBase",
    env: "QQ_API_BASE",
    required: false,
    secret: false,
    description: "Override the API base, https://api.sgroup.qq.com.",
  },
  {
    key: "tokenUrl",
    env: "QQ_TOKEN_URL",
    required: false,
    secret: false,
    description:
      "Override the token endpoint, https://bots.qq.com/app/getAppAccessToken.",
  },
];

/**
 * The QQ channel.
 *
 * QQ delivers inbound events by signed webhook and the adapter opens no connection or listener of
 * its own, so `transport` is `"webhook"`. The route runs `webhook.handle`, which passes the raw body
 * and signature headers to `QQAdapter.handleWebhook` and returns its status. `webhook.verify` and
 * `webhook.ingest` are unused fail-closed stubs: the signature covers the raw body and the answer
 * may carry a body, which only `handle` can serve.
 *
 * `create` refuses a missing, empty or non-string value with a `GatewayConfigurationError` coded
 * `invalid_config` that names the key; it performs no network call.
 *
 * @public
 */
export const qqChannel = {
  platform: "qq" as const,
  transport: "webhook" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): QQAdapter {
    return new QQAdapter({
      appId: readers.requiredString(config, "appId"),
      appSecret: readers.requiredString(config, "appSecret"),
      apiBase: readers.readString(config, "apiBase"),
      tokenUrl: readers.readString(config, "tokenUrl"),
      fetch: readers.readFunction<QQFetch>(config, "fetch"),
    });
  },
  webhook: {
    verify: () => false,
    ingest: () => Promise.resolve("malformed" as const),
    async handle(
      adapter: QQAdapter,
      request: WebhookRequest,
    ): Promise<WebhookAnswer> {
      const answer = await adapter.handleWebhook(
        request.rawBody,
        request.headers["x-signature-ed25519"],
        request.headers["x-signature-timestamp"],
      );
      const body =
        "body" in answer && answer.body !== undefined ? answer.body : undefined;
      return body === undefined
        ? { status: answer.status }
        : {
            status: answer.status,
            body: JSON.stringify(body),
            contentType: "application/json",
          };
    },
  },
};
