/**
 * `yuanbaoChannel` — the Yuanbao bot channel described as data.
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
import { YuanbaoAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";

const SIGNATURE_HEADER = "x-signature";
const TIMESTAMP_HEADER = "x-timestamp";

function invalid(key: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-yuanbao: config.${key} must be a string`,
    detail: key,
  });
}

const CONFIG: ReadonlyArray<ConfigField> = [
  field("appId", "YUANBAO_APP_ID", "The bot's app id."),
  field("appSecret", "YUANBAO_APP_SECRET", "The bot's app secret, exchanged for an access token.", {
    secret: true,
  }),
  field(
    "callbackSecret",
    "YUANBAO_CALLBACK_SECRET",
    "The callback signing secret that signs each webhook.",
    { secret: true },
  ),
  field("apiBase", "YUANBAO_API_BASE", "The Yuanbao API base URL override.", { required: false }),
];

const { requiredString, optionalEntry } = stringConfigReaders(invalid);

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
      ...optionalEntry(config, "apiBase"),
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
      return ingestOutcome((await adapter.ingestWebhook(payload)).status);
    },
  },
};
