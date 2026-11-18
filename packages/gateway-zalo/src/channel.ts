/**
 * `zaloChannel` — the Zalo Official Account channel described as data.
 *
 * Typed locally on purpose: the object is structurally a core `ChannelDescriptor`, and the
 * integration package assigns it to one, so a drift between the two fails there.
 */

import { channelConfigReaders } from "@theokit/gateway";

import { ZaloAdapter } from "./adapter.js";

const readers = channelConfigReaders("gateway-zalo");

type Headers = Readonly<Record<string, string | undefined>>;

const header = (headers: Headers, name: string): string | undefined =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];

const CONFIG = [
  {
    key: "appId",
    required: true,
    secret: true,
    description: "The Zalo app id.",
  },
  {
    key: "oaSecretKey",
    required: true,
    secret: true,
    description: "The OA secret key that signs inbound webhooks.",
  },
  {
    key: "accessToken",
    required: true,
    secret: true,
    description: "The OA access token (not refreshed by the adapter).",
  },
] as const;

/**
 * The Zalo Official Account channel: inbound events arrive by webhook, so the app routes each request to
 * `webhook.verify` and then `webhook.ingest`. `verify` checks the `x-zevent-signature` header (any case) against the raw body.
 * `ingest` reports `"malformed"` for a payload that is not a JSON object, `"no_handler"` when a
 * text message arrives and no handler is subscribed (answer that with a non-success status so the
 * platform redelivers), and `"delivered"` otherwise, including for events it ignores.
 * `create` refuses a credential that is not a string; the adapter refuses an empty one.
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
    });
  },
  webhook: {
    verify(
      adapter: ZaloAdapter,
      request: { readonly rawBody: string; readonly headers: Headers },
    ): boolean {
      return adapter.verifyWebhook(request.rawBody, header(request.headers, "x-zevent-signature"));
    },
    async ingest(
      adapter: ZaloAdapter,
      payload: unknown,
    ): Promise<"delivered" | "malformed" | "no_handler"> {
      const { status } = await adapter.dispatchWebhookPayload(payload);
      if (status === 400) return "malformed";
      return status === 503 ? "no_handler" : "delivered";
    },
  },
};
