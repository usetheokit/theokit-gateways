/**
 * `zaloChannel` — the Zalo Official Account channel described as data.
 *
 * Typed locally on purpose: this package's peer range reaches back to gateway releases that lack
 * the newest core types. The object is structurally a `ChannelDescriptor`; the integration
 * package assigns it to one.
 */

import { ZaloAdapter } from "./adapter.js";

function requiredString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string") throw new Error(`gateway-zalo: config.${key} must be a string`);
  return value;
}

function optionalString(
  config: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
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

interface WebhookRequestLike {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

const CONFIG = [
  {
    key: "appId",
    required: true,
    secret: false,
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
    description: "The OA access token used for the Open API.",
  },
  {
    key: "apiBase",
    required: false,
    secret: false,
    description: "Override the API base, https://openapi.zalo.me.",
  },
] as const;

/**
 * The Zalo channel: Zalo delivers inbound events by signed webhook, so the app routes each request
 * to `webhook.verify` and then `webhook.ingest`. `verify` checks the `x-zevent-signature` header
 * (any case, `mac=<hex>`) against the raw body. `ingest` reports `"malformed"` for a payload that
 * is not a JSON object, `"no_handler"` when a text message arrives and no handler is subscribed,
 * and `"delivered"` otherwise (duplicates, other apps' events and non-text events too). *
 * @public
 */
export const zaloChannel = {
  platform: "zalo" as const,
  transport: "webhook" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): ZaloAdapter {
    const apiBase = optionalString(config, "apiBase");
    return new ZaloAdapter({
      appId: requiredString(config, "appId"),
      oaSecretKey: requiredString(config, "oaSecretKey"),
      accessToken: requiredString(config, "accessToken"),
      ...(apiBase !== undefined ? { apiBase } : {}),
    });
  },
  webhook: {
    verify(adapter: ZaloAdapter, request: WebhookRequestLike): boolean {
      return adapter.verifyWebhook(
        request.rawBody,
        headerValue(request.headers, "x-zevent-signature"),
      );
    },
    async ingest(
      adapter: ZaloAdapter,
      payload: unknown,
    ): Promise<"delivered" | "malformed" | "no_handler"> {
      return adapter.dispatchWebhookPayload(payload);
    },
  },
};
