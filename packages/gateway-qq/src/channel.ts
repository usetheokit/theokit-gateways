/**
 * `qqChannel` — the QQ channel described as data.
 *
 * Typed locally on purpose: this package's peer range on `@theokit/gateway` is a floor, and a
 * published `.d.ts` naming a core type that an older core lacks would break a consumer there. The
 * object is structurally a `ChannelDescriptor`.
 */

import type { IngestResult, WebhookAnswer, WebhookRequest } from "@theokit/gateway";
import { GatewayConfigurationError } from "@theokit/gateway";

import { QQAdapter } from "./adapter.js";
import type { QQFetch, QQWebhookPayload } from "./types.js";

const ORIGIN = "gateway-qq";

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError(ORIGIN, {
    code: "invalid_config",
    message: `${ORIGIN}: config.${key} must be ${expected}`,
    detail: key,
  });
}

function readString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.length === 0) throw invalid(key, "a non-empty string");
  return value;
}

function optionalString(
  config: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, string> {
  const value = config[key];
  if (value === undefined || value === "") return {};
  if (typeof value !== "string") throw invalid(key, "a string");
  return { [key]: value };
}

function optionalFetch(config: Readonly<Record<string, unknown>>): { fetch?: QQFetch } {
  const value = config.fetch;
  if (value === undefined) return {};
  if (typeof value !== "function") throw invalid("fetch", "a function");
  return { fetch: value as QQFetch };
}

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
    env: "QQ_APP_ID",
    required: true,
    secret: false,
    description: "The bot's AppID from q.qq.com.",
  },
  {
    key: "appSecret",
    env: "QQ_APP_SECRET",
    required: true,
    secret: true,
    description:
      "The bot's AppSecret; exchanged for an access token and the seed of the webhook signing key.",
  },
  {
    key: "apiBase",
    env: "QQ_API_BASE",
    required: false,
    secret: false,
    description: "Override the API base, https://api.sgroup.qq.com.",
  },
  {
    key: "tokenUrl",
    env: "QQ_TOKEN_URL",
    required: false,
    secret: false,
    description: "Override the token endpoint, https://bots.qq.com/app/getAppAccessToken.",
  },
];

function header(request: WebhookRequest, name: string): string | undefined {
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/**
 * The QQ channel.
 *
 * QQ delivers inbound events by signed webhook and the adapter opens no connection or listener of
 * its own, so `transport` is `"webhook"`. `webhook.verify` checks the signature headers against the
 * raw body and `webhook.ingest` dispatches a verified payload through the adapter. QQ also sets `webhook.handle`, because its callback URL validation (op 13)
 * is answered with a signed body that only `handleWebhook` produces.
 *
 * `create` refuses a missing, empty or non-string value with a `GatewayConfigurationError` coded
 * `invalid_config` that names the key; it performs no network call.
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
      appId: readString(config, "appId"),
      appSecret: readString(config, "appSecret"),
      ...optionalString(config, "apiBase"),
      ...optionalString(config, "tokenUrl"),
      ...optionalFetch(config),
    });
  },
  webhook: {
    verify(adapter: QQAdapter, request: WebhookRequest): boolean {
      return adapter.verifyWebhook(
        request.rawBody,
        header(request, "x-signature-ed25519"),
        header(request, "x-signature-timestamp"),
      );
    },
    async ingest(adapter: QQAdapter, payload: unknown): Promise<IngestResult> {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        return "malformed";
      }
    if ((payload as QQWebhookPayload).op === 13) return "malformed";
      const answer = await adapter.dispatchWebhookPayload(payload as QQWebhookPayload);
      return answer.status === 503 ? "no_handler" : "delivered";
    },
    async handle(adapter: QQAdapter, request: WebhookRequest): Promise<WebhookAnswer> {
      const answer = await adapter.handleWebhook(
        request.rawBody,
        header(request, "x-signature-ed25519"),
        header(request, "x-signature-timestamp"),
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
