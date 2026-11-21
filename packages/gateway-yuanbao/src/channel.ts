/**
 * `yuanbaoChannel` — the Yuanbao bot channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { YuanbaoAdapter } from "./adapter.js";

const SIGNATURE_HEADER = "x-signature";
const TIMESTAMP_HEADER = "x-timestamp";

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
    env: "YUANBAO_APP_ID",
    required: true,
    secret: false,
    description: "The bot's app id.",
  },
  {
    key: "appSecret",
    env: "YUANBAO_APP_SECRET",
    required: true,
    secret: true,
    description: "The bot's app secret, exchanged for an access token.",
  },
  {
    key: "callbackSecret",
    env: "YUANBAO_CALLBACK_SECRET",
    required: true,
    secret: true,
    description: "The callback signing secret that signs each webhook.",
  },
];

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

/**
 * The Yuanbao channel: Yuanbao delivers inbound events by webhook, so the app routes each request to
 * `webhook.verify` and then `webhook.ingest` (or mounts `createWebhookHandler`).
 *
 * `verify` checks the `X-Signature` and `X-Timestamp` headers (any case) against the raw body. `ingest`
 * reports `"malformed"` for a payload that is not a JSON object, dispatching nothing; it reports
 * `"no_handler"` when a text message arrived and none is subscribed, and `"delivered"` otherwise
 * (an event that is not a text message is acknowledged and skipped).
 * `create` refuses a field that is not a string, and the adapter refuses an empty one.
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
        headerValue(request.headers, SIGNATURE_HEADER),
        headerValue(request.headers, TIMESTAMP_HEADER),
      );
    },
    async ingest(
      adapter: YuanbaoAdapter,
      payload: unknown,
    ): Promise<"delivered" | "malformed" | "no_handler"> {
      const answer = await adapter.ingestWebhook(payload);
      if (answer.status === 503) return "no_handler";
      return answer.status === 200 ? "delivered" : "malformed";
    },
  },
};
