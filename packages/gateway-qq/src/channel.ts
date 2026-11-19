/**
 * `qqChannel` — the QQ Bot channel described as data.
 *
 * Typed locally on purpose: the object is structurally a core `ChannelDescriptor`, and the
 * integration package assigns it to one, so a drift between the two fails there.
 */

import { channelConfigReaders, ingestResultForStatus, webhookHeader } from "@theokit/gateway";
import { QQAdapter } from "./adapter.js";

const { requiredString } = channelConfigReaders("gateway-qq");

type Headers = Readonly<Record<string, string | undefined>>;

const CONFIG = [
  {
    key: "appId",
    env: "QQ_APP_ID",
    required: true,
    secret: true,
    description: "The bot's AppID.",
  },
  {
    key: "appSecret",
    env: "QQ_APP_SECRET",
    required: true,
    secret: true,
    description: "The bot's AppSecret; also seeds the webhook signing key.",
  },
] as const;

/**
 * The QQ Bot channel: inbound events arrive by webhook, so the app routes each request to
 * `webhook.verify` and then `webhook.ingest`. `verify` checks the Ed25519 `x-signature-ed25519` and `x-signature-timestamp` headers against the raw body. QQ's callback URL validation (op 13) is signed by us, not by QQ, so `handle` answers it through `QQAdapter.handleWebhook` and returns the signed JSON body.
 * `ingest` reports `"malformed"` for a payload that is not a JSON object, `"no_handler"` when a
 * text message arrives and no handler is subscribed (answer that with a non-success status so the
 * platform redelivers), and `"delivered"` otherwise, including for events it ignores.
 * `create` refuses a credential that is not a non-empty string with a `GatewayConfigurationError`.
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
      appId: requiredString(config, "appId"),
      appSecret: requiredString(config, "appSecret"),
    });
  },
  webhook: {
    verify(
      adapter: QQAdapter,
      request: { readonly rawBody: string; readonly headers: Headers },
    ): boolean {
      return adapter.verifyWebhook(
        request.rawBody,
        webhookHeader(request.headers, "x-signature-ed25519"),
        webhookHeader(request.headers, "x-signature-timestamp"),
      );
    },
    async ingest(
      adapter: QQAdapter,
      payload: unknown,
    ): Promise<"delivered" | "malformed" | "no_handler"> {
      const { status } = await adapter.dispatchWebhookPayload(payload);
      return ingestResultForStatus(status);
    },
    async handle(
      adapter: QQAdapter,
      request: { readonly rawBody: string; readonly headers: Headers },
    ): Promise<{ status: number; body?: string; contentType?: string }> {
      const answer = await adapter.handleWebhook(
        request.rawBody,
        webhookHeader(request.headers, "x-signature-ed25519"),
        webhookHeader(request.headers, "x-signature-timestamp"),
      );
      return {
        status: answer.status,
        body: JSON.stringify(answer.body ?? {}),
        contentType: "application/json",
      };
    },
  },
};
