/**
 * `qqChannel` — the QQ Bot channel described as data.
 *
 * Typed locally on purpose: this package's peer range reaches back to gateway releases that lack
 * the newest core types. The object is structurally a `ChannelDescriptor`; the integration
 * package assigns it to one.
 */

import { GatewayConfigurationError } from "@theokit/gateway";
import { QQAdapter } from "./adapter.js";

function invalid(key: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway-qq", {
    code: "invalid_config",
    message: `gateway-qq: config.${key} must be a string`,
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
    description: "The bot AppID (q.qq.com).",
  },
  {
    key: "appSecret",
    required: true,
    secret: true,
    description: "The bot AppSecret; also seeds the webhook signing key (q.qq.com).",
  },
  {
    key: "apiBase",
    required: false,
    secret: false,
    description: "Override the API base, https://api.sgroup.qq.com.",
  },
  {
    key: "tokenUrl",
    required: false,
    secret: false,
    description: "Override the token endpoint, https://bots.qq.com/app/getAppAccessToken.",
  },
] as const;

/**
 * The QQ channel: QQ delivers inbound events by Ed25519-signed webhook. `verify` checks the
 * `x-signature-ed25519` and `x-signature-timestamp` headers (any case) against the raw body.
 * `ingest` reports `"malformed"` for a payload that is not a JSON object, `"no_handler"` when a
 * C2C text message arrives and no handler is subscribed, and `"delivered"` otherwise.
 * The callback URL validation (`op` 13) is not signed by QQ and needs a JSON answer, so the
 * descriptor also defines `handle`, which answers it and otherwise runs the same verify and ingest
 * flow as `QQAdapter.handleWebhook`. *
 * @public
 */
export const qqChannel = {
  platform: "qq" as const,
  transport: "webhook" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): QQAdapter {
    const apiBase = optionalString(config, "apiBase");
    const tokenUrl = optionalString(config, "tokenUrl");
    return new QQAdapter({
      appId: requiredString(config, "appId"),
      appSecret: requiredString(config, "appSecret"),
      ...(apiBase !== undefined ? { apiBase } : {}),
      ...(tokenUrl !== undefined ? { tokenUrl } : {}),
    });
  },
  webhook: {
    verify(adapter: QQAdapter, request: WebhookRequestLike): boolean {
      return adapter.verifyWebhook(
        request.rawBody,
        headerValue(request.headers, "x-signature-ed25519"),
        headerValue(request.headers, "x-signature-timestamp"),
      );
    },
    async ingest(
      adapter: QQAdapter,
      payload: unknown,
    ): Promise<"delivered" | "malformed" | "no_handler"> {
      return adapter.dispatchWebhookPayload(payload);
    },
    async handle(
      adapter: QQAdapter,
      request: WebhookRequestLike,
    ): Promise<{ status: number; body?: string; contentType?: string }> {
      const answer = await adapter.handleWebhook(
        request.rawBody,
        headerValue(request.headers, "x-signature-ed25519"),
        headerValue(request.headers, "x-signature-timestamp"),
      );
      return answer.body === undefined
        ? { status: answer.status }
        : {
            status: answer.status,
            body: JSON.stringify(answer.body),
            contentType: "application/json",
          };
    },
  },
};
