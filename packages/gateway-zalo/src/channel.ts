/**
 * `zaloChannel` — the Zalo Official Account channel described as data.
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
import { ZaloAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";

const SIGNATURE_HEADER = "x-zevent-signature";

function invalid(key: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-zalo: config.${key} must be a string`,
    detail: key,
  });
}

const CONFIG: ReadonlyArray<ConfigField> = [
  field("appId", "ZALO_APP_ID", "The Zalo app id; part of the signed string of every webhook."),
  field(
    "oaSecretKey",
    "ZALO_OA_SECRET_KEY",
    "The Official Account secret key that signs each webhook.",
    { secret: true },
  ),
  field(
    "accessToken",
    "ZALO_ACCESS_TOKEN",
    "An Official Account access token for the Open API; it expires.",
    { secret: true },
  ),
  field("apiBase", "ZALO_API_BASE", "The Zalo Open API base URL override.", { required: false }),
];

const { requiredString, optionalEntry } = stringConfigReaders(invalid);

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
      ...optionalEntry(config, "apiBase"),
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
      return ingestOutcome((await adapter.ingestWebhook(payload)).status);
    },
  },
};
