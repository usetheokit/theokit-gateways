/**
 * `zaloChannel` — the Zalo channel described as data.
 *
 * Typed locally on purpose: this package's peer range on `@theokit/gateway` is a floor, and a
 * published `.d.ts` naming a core type that an older core lacks would break a consumer there. The
 * object is structurally a `ChannelDescriptor`.
 */

import { channelConfigReaders, type WebhookAnswer, type WebhookRequest } from "@theokit/gateway";

import { ZaloAdapter } from "./adapter.js";
import type { ZaloFetch } from "./types.js";

const ORIGIN = "gateway-zalo";

const readers = channelConfigReaders(ORIGIN);

/** Config fields, shaped like the core's `ChannelConfigField` (typed locally). */
const CONFIG = [
  {
    key: "appId",
    env: "ZALO_APP_ID",
    required: true,
    secret: false,
    description: "The Zalo app id.",
  },
  {
    key: "oaSecretKey",
    env: "ZALO_OA_SECRET_KEY",
    required: true,
    secret: true,
    description: "The Zalo OA secret key; verifies each webhook.",
  },
  {
    key: "accessToken",
    env: "ZALO_ACCESS_TOKEN",
    required: true,
    secret: true,
    description: "A Zalo Official Account access token; it expires and is not refreshed.",
  },
  {
    key: "apiBase",
    env: "ZALO_API_BASE",
    required: false,
    secret: false,
    description: "Override the Open API base, https://openapi.zalo.me.",
  },
];

/**
 * The Zalo channel.
 *
 * Zalo delivers inbound events by signed webhook and the adapter opens no connection or listener of
 * its own, so `transport` is `"webhook"`. The route runs `webhook.handle`, which passes the raw body
 * and signature headers to `ZaloAdapter.handleWebhook` and returns its status. `webhook.verify` and
 * `webhook.ingest` are unused fail-closed stubs: the signature covers the raw body and the answer
 * may carry a body, which only `handle` can serve.
 *
 * `create` refuses a missing, empty or non-string value with a `GatewayConfigurationError` coded
 * `invalid_config` that names the key; it performs no network call.
 *
 * @public
 */
export const zaloChannel = {
  platform: "zalo" as const,
  transport: "webhook" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): ZaloAdapter {
    return new ZaloAdapter({
      appId: readers.requiredString(config, "appId"),
      oaSecretKey: readers.requiredString(config, "oaSecretKey"),
      accessToken: readers.requiredString(config, "accessToken"),
      apiBase: readers.readString(config, "apiBase"),
      fetch: readers.readFunction<ZaloFetch>(config, "fetch"),
    });
  },
  webhook: {
    verify: () => false,
    ingest: () => Promise.resolve("malformed" as const),
    async handle(adapter: ZaloAdapter, request: WebhookRequest): Promise<WebhookAnswer> {
      const answer = await adapter.handleWebhook(
        request.rawBody,
        request.headers["x-zevent-signature"],
      );
      return { status: answer.status };
    },
  },
};
