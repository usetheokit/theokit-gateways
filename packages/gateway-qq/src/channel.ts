/**
 * `qqChannel` — the QQ Bot channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { type ConfigField, field } from "../../../shared/channel-config-field.js";
import {
  headerValue,
  ingestOutcome,
  stringConfigReaders,
} from "../../../shared/webhook-channel-readers.js";
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

const CONFIG: ReadonlyArray<ConfigField> = [
  field("appId", "QQ_APP_ID", "The QQ Bot AppID."),
  field(
    "appSecret",
    "QQ_APP_SECRET",
    "The QQ Bot AppSecret; fetches the access token and signs callback validation.",
    { secret: true },
  ),
  field("apiBase", "QQ_API_BASE", "The QQ Bot API base URL override.", { required: false }),
  field("tokenUrl", "QQ_TOKEN_URL", "The QQ access-token endpoint override.", { required: false }),
];

const { requiredString, optionalEntry } = stringConfigReaders(invalid);

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
      ...optionalEntry(config, "apiBase"),
      ...optionalEntry(config, "tokenUrl"),
    });
  },
  webhook: {
    methods: ["POST"] as const,
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
      return ingestOutcome((await adapter.ingestWebhook(payload)).status);
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
