/**
 * `yuanbaoChannel` — the Tencent Yuanbao channel described as data.
 *
 * Typed locally on purpose: the object is structurally a core `ChannelDescriptor`, and the
 * integration package assigns it to one, so a drift between the two fails there.
 */

import { channelConfigReaders, ingestResultForStatus, webhookHeader } from "@theokit/gateway";
import { YuanbaoAdapter } from "./adapter.js";

const { requiredString } = channelConfigReaders("gateway-yuanbao");

type Headers = Readonly<Record<string, string | undefined>>;

const CONFIG = [
  {
    key: "appId",
    env: "YUANBAO_APP_ID",
    required: true,
    secret: true,
    description: "The bot's app id.",
  },
  {
    key: "appSecret",
    env: "YUANBAO_APP_SECRET",
    required: true,
    secret: true,
    description: "The bot's app secret.",
  },
  {
    key: "callbackSecret",
    env: "YUANBAO_CALLBACK_SECRET",
    required: true,
    secret: true,
    description: "The secret that signs inbound callbacks.",
  },
] as const;

/**
 * The Tencent Yuanbao channel: inbound events arrive by webhook, so the app routes each request to
 * `webhook.verify` and then `webhook.ingest`. `verify` checks the `x-signature` and `x-timestamp` headers against the raw body with the callback secret (the wire protocol is unverified, see the README).
 * `ingest` reports `"malformed"` for a payload that is not a JSON object, `"no_handler"` when a
 * text message arrives and no handler is subscribed (answer that with a non-success status so the
 * platform redelivers), and `"delivered"` otherwise, including for events it ignores.
 * `create` refuses a credential that is not a non-empty string with a `GatewayConfigurationError`.
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
      appId: requiredString(config, "appId"),
      appSecret: requiredString(config, "appSecret"),
      callbackSecret: requiredString(config, "callbackSecret"),
    });
  },
  webhook: {
    verify(
      adapter: YuanbaoAdapter,
      request: { readonly rawBody: string; readonly headers: Headers },
    ): boolean {
      return adapter.verifyWebhook(
        request.rawBody,
        webhookHeader(request.headers, "x-signature"),
        webhookHeader(request.headers, "x-timestamp"),
      );
    },
    async ingest(
      adapter: YuanbaoAdapter,
      payload: unknown,
    ): Promise<"delivered" | "malformed" | "no_handler"> {
      const { status } = await adapter.dispatchWebhookPayload(payload);
      return ingestResultForStatus(status);
    },
  },
};
