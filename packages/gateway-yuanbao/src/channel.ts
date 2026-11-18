/**
 * `yuanbaoChannel` — the Tencent Yuanbao channel described as data.
 *
 * Typed locally on purpose: the object is structurally a core `ChannelDescriptor`, and the
 * integration package assigns it to one, so a drift between the two fails there.
 */

import { YuanbaoAdapter } from "./adapter.js";

function requiredString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string") throw new Error(`gateway-yuanbao: config.${key} must be a string`);
  return value;
}

function headerValue(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

const CONFIG = [
  {
    key: "appId",
    required: true,
    secret: true,
    description: "The bot's app id.",
  },
  {
    key: "appSecret",
    required: true,
    secret: true,
    description: "The bot's app secret.",
  },
  {
    key: "callbackSecret",
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
 * `create` refuses a credential that is not a string; the adapter refuses an empty one.
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
      request: {
        readonly rawBody: string;
        readonly headers: Readonly<Record<string, string | undefined>>;
      },
    ): boolean {
      return adapter.verifyWebhook(
        request.rawBody,
        headerValue(request.headers, "x-signature"),
        headerValue(request.headers, "x-timestamp"),
      );
    },
    async ingest(
      adapter: YuanbaoAdapter,
      payload: unknown,
    ): Promise<"delivered" | "malformed" | "no_handler"> {
      const answer = await adapter.dispatchWebhookPayload(payload);
      if (answer.status === 400) return "malformed";
      return answer.status === 503 ? "no_handler" : "delivered";
    },
  },
};
