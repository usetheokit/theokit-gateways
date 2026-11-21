/**
 * `qqChannel` — the QQ Bot channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { QQAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";

const SIGNATURE_HEADER = "x-signature-ed25519";
const TIMESTAMP_HEADER = "x-signature-timestamp";

type Headers = Readonly<Record<string, string | undefined>>;

function invalid(key: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-qq: config.${key} must be a string`,
    detail: key,
  });
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
    description: "The QQ Bot AppID.",
  },
  {
    key: "appSecret",
    env: "QQ_APP_SECRET",
    required: true,
    secret: true,
    description: "The QQ Bot AppSecret; fetches the access token and signs callback validation.",
  },
  {
    key: "apiBase",
    env: "QQ_API_BASE",
    required: false,
    secret: false,
    description: "The QQ Bot API base URL override.",
  },
  {
    key: "tokenUrl",
    env: "QQ_TOKEN_URL",
    required: false,
    secret: false,
    description: "The QQ access-token endpoint override.",
  },
];

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
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalid(key);
  return value;
}

function optionalEntry(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function headerValue(headers: Headers, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/**
 * The QQ channel: QQ delivers inbound events by signed webhook, so the app routes each request to
 * `webhook.verify` and then `webhook.ingest`, or mounts `createWebhookHandler`.
 *
 * `verify` checks the `X-Signature-Ed25519` and `X-Signature-Timestamp` headers (any case) against
 * the raw body. `ingest` reports `"malformed"` for a payload that is not a JSON object, dispatching
 * nothing; `"no_handler"` when a C2C text message arrived and none is subscribed; and `"delivered"`
 * otherwise (other events are acknowledged and skipped).
 *
 * QQ's callback URL validation (`op` 13) is signed by this bot, not by QQ, so it cannot pass
 * `verify`. `webhook.handle`, which `createWebhookHandler` uses, answers it with the signed
 * `plain_token` JSON and sends every other request through verify and ingest.
 *
 * `create` refuses a field that is not a string, and the adapter refuses an empty one.
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
      ...optionalEntry("apiBase", optionalString(config, "apiBase")),
      ...optionalEntry("tokenUrl", optionalString(config, "tokenUrl")),
    });
  },
  webhook: {
    verify(adapter: QQAdapter, request: { readonly rawBody: string; readonly headers: Headers }) {
      return adapter.verifyWebhook(
        request.rawBody,
        headerValue(request.headers, SIGNATURE_HEADER),
        headerValue(request.headers, TIMESTAMP_HEADER),
      );
    },
    async ingest(
      adapter: QQAdapter,
      payload: unknown,
    ): Promise<"delivered" | "malformed" | "no_handler"> {
      const answer = await adapter.ingestWebhook(payload);
      if (answer.status === 503) return "no_handler";
      return answer.status === 200 ? "delivered" : "malformed";
    },
    async handle(
      adapter: QQAdapter,
      request: { readonly rawBody: string; readonly headers: Headers },
    ): Promise<{ status: number; body?: string; contentType?: string }> {
      const answer = await adapter.handleWebhook(
        request.rawBody,
        headerValue(request.headers, SIGNATURE_HEADER),
        headerValue(request.headers, TIMESTAMP_HEADER),
      );
      if (answer.body === undefined) return { status: answer.status };
      return {
        status: answer.status,
        body: JSON.stringify(answer.body),
        contentType: "application/json",
      };
    },
  },
};
