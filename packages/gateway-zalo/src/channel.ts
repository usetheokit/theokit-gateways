/**
 * `zaloChannel` — the Zalo Official Account channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { ZaloAdapter } from "./adapter.js";

const SIGNATURE_HEADER = "x-zevent-signature";

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
    description: "The Zalo app id; part of the signed string of every webhook.",
  },
  {
    key: "oaSecretKey",
    env: "ZALO_OA_SECRET_KEY",
    required: true,
    secret: true,
    description: "The Official Account secret key that signs each webhook.",
  },
  {
    key: "accessToken",
    env: "ZALO_OA_ACCESS_TOKEN",
    required: true,
    secret: true,
    description: "An Official Account access token for the Open API; it expires.",
  },
];

function requiredString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string") throw new Error(`gateway-zalo: config.${key} must be a string`);
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
 * The Zalo channel: Zalo delivers inbound events by webhook, so the app routes each request to
 * `webhook.verify` and then `webhook.ingest` (or mounts `createWebhookHandler`).
 *
 * `verify` checks the `X-ZEvent-Signature` header (any case) against the raw body. `ingest`
 * reports `"malformed"` for a payload that is not a JSON object, dispatching nothing; it reports
 * `"no_handler"` when a text message arrived and none is subscribed, and `"delivered"` otherwise
 * (an event that is not a text message, or is for another app, is acknowledged and skipped).
 * `create` refuses a field that is not a string, and the adapter refuses an empty one.
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
      appId: requiredString(config, "appId"),
      oaSecretKey: requiredString(config, "oaSecretKey"),
      accessToken: requiredString(config, "accessToken"),
    });
  },
  webhook: {
    verify(
      adapter: ZaloAdapter,
      request: {
        readonly rawBody: string;
        readonly headers: Readonly<Record<string, string | undefined>>;
      },
    ): boolean {
      return adapter.verifyWebhook(request.rawBody, headerValue(request.headers, SIGNATURE_HEADER));
    },
    async ingest(
      adapter: ZaloAdapter,
      payload: unknown,
    ): Promise<"delivered" | "malformed" | "no_handler"> {
      const answer = await adapter.ingestWebhook(payload);
      if (answer.status === 503) return "no_handler";
      return answer.status === 200 ? "delivered" : "malformed";
    },
  },
};
