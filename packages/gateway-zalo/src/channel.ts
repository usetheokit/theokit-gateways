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

function header(request: WebhookRequest, name: string): string | undefined {
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

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
    verify(): boolean {
      return false;
    },
    ingest(): Promise<"malformed"> {
      return Promise.resolve("malformed");
    },
    async handle(adapter: ZaloAdapter, request: WebhookRequest): Promise<WebhookAnswer> {
      const answer = await adapter.handleWebhook(
        request.rawBody,
        header(request, "x-zevent-signature"),
      );
      const body = "body" in answer && answer.body !== undefined ? answer.body : undefined;
      return body === undefined
        ? { status: answer.status }
        : { status: answer.status, body: JSON.stringify(body), contentType: "application/json" };
    },
  },
};
