/**
 * `yuanbaoChannel` — the Tencent Yuanbao channel described as data.
 *
 * Typed locally on purpose: this package's peer range reaches back to gateway releases that lack
 * the newest core types. The object is structurally a `ChannelDescriptor`; the integration
 * package assigns it to one.
 */

import { GatewayConfigurationError } from "@theokit/gateway";
import { YuanbaoAdapter } from "./adapter.js";

function invalid(key: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway-yuanbao", {
    code: "invalid_config",
    message: `gateway-yuanbao: config.${key} must be a string`,
    detail: key,
  });
}

function requiredString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string") throw invalid(key);
  return value;
}

function optionalString(
  config: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw invalid(key);
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
    description: "The bot app id (Yuanbao bot console).",
  },
  {
    key: "appSecret",
    required: true,
    secret: true,
    description: "The bot app secret (Yuanbao bot console).",
  },
  {
    key: "callbackSecret",
    required: true,
    secret: true,
    description: "The secret that signs inbound callbacks (Yuanbao bot console).",
  },
  {
    key: "apiBase",
    required: false,
    secret: false,
    description: "Override the API base, https://yuanbao.tencent.com.",
  },
] as const;

/**
 * The Yuanbao channel: Yuanbao delivers inbound events by signed webhook, so the app routes each
 * request to `webhook.verify` and then `webhook.ingest`. `verify` checks the `x-signature` and
 * `x-timestamp` headers (any case) against the raw body with the callback secret. `ingest` reports
 * `"malformed"` for a payload that is not a JSON object, `"no_handler"` when a text message arrives
 * and no handler is subscribed, and `"delivered"` otherwise (duplicates and non-text events too). *
 * @public
 */
export const yuanbaoChannel = {
  platform: "yuanbao" as const,
  transport: "webhook" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): YuanbaoAdapter {
    const apiBase = optionalString(config, "apiBase");
    return new YuanbaoAdapter({
      appId: requiredString(config, "appId"),
      appSecret: requiredString(config, "appSecret"),
      callbackSecret: requiredString(config, "callbackSecret"),
      ...(apiBase !== undefined ? { apiBase } : {}),
    });
  },
  webhook: {
    verify(adapter: YuanbaoAdapter, request: WebhookRequestLike): boolean {
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
      return adapter.dispatchWebhookPayload(payload);
    },
  },
};
