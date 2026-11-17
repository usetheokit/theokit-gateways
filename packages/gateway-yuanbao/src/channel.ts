/**
 * `yuanbaoChannel` — the Yuanbao channel described as data.
 *
 * Typed locally on purpose: this package's peer range on `@theokit/gateway` is a floor, and a
 * published `.d.ts` naming a core type that an older core lacks would break a consumer there. The
 * object is structurally a `ChannelDescriptor`.
 */

import type { IngestResult, WebhookRequest } from "@theokit/gateway";
import { GatewayConfigurationError } from "@theokit/gateway";

import { YuanbaoAdapter } from "./adapter.js";
import type { YuanbaoFetch, YuanbaoWebhookEvent } from "./types.js";

const ORIGIN = "gateway-yuanbao";

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

function optionalFetch(config: Readonly<Record<string, unknown>>): { fetch?: YuanbaoFetch } {
  const value = config.fetch;
  if (value === undefined) return {};
  if (typeof value !== "function") throw invalid("fetch", "a function");
  return { fetch: value as YuanbaoFetch };
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
    env: "YUANBAO_APP_ID",
    required: true,
    secret: false,
    description: "The bot's app id from the Yuanbao bot console.",
  },
  {
    key: "appSecret",
    env: "YUANBAO_APP_SECRET",
    required: true,
    secret: true,
    description: "The bot's app secret; exchanged for a short-lived access token.",
  },
  {
    key: "callbackSecret",
    env: "YUANBAO_CALLBACK_SECRET",
    required: true,
    secret: true,
    description: "The callback signing secret that signs each callback request.",
  },
  {
    key: "apiBase",
    env: "YUANBAO_API_BASE",
    required: false,
    secret: false,
    description: "Override the API base, https://yuanbao.tencent.com.",
  },
];

function header(request: WebhookRequest, name: string): string | undefined {
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/**
 * The Yuanbao channel.
 *
 * Yuanbao delivers inbound events by signed webhook and the adapter opens no connection or listener of
 * its own, so `transport` is `"webhook"`. `webhook.verify` checks the signature headers against the
 * raw body and `webhook.ingest` dispatches a verified payload through the adapter.
 *
 * `create` refuses a missing, empty or non-string value with a `GatewayConfigurationError` coded
 * `invalid_config` that names the key; it performs no network call.
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
      appId: readString(config, "appId"),
      appSecret: readString(config, "appSecret"),
      callbackSecret: readString(config, "callbackSecret"),
      ...optionalString(config, "apiBase"),
      ...optionalFetch(config),
    });
  },
  webhook: {
    verify(adapter: YuanbaoAdapter, request: WebhookRequest): boolean {
      return adapter.verifyWebhook(
        request.rawBody,
        header(request, "x-signature"),
        header(request, "x-timestamp"),
      );
    },
    async ingest(adapter: YuanbaoAdapter, payload: unknown): Promise<IngestResult> {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        return "malformed";
      }
      const answer = await adapter.dispatchWebhookPayload(payload as YuanbaoWebhookEvent);
      return answer.status === 503 ? "no_handler" : "delivered";
    },
  },
};
