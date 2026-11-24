/**
 * `smsChannel` — the SMS channel (Twilio backend only) described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` naming a core type must not break a consumer on an older peer floor.
 */

import { SMSAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";
import { rememberSmsOptions, twilioWebhook } from "./fetch-webhook.js";

const KEYS = ["accountSid", "authToken", "fromNumber", "publicUrl"] as const;

function readString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigurationError({
      code: "invalid_config",
      message: `gateway-sms: config.${key} must be a non-empty string`,
      detail: key,
    });
  }
  return value;
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly env: string;
  readonly description: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "accountSid",
    required: true,
    secret: false,
    env: "SMS_ACCOUNT_SID",
    description: "The Twilio account SID.",
  },
  {
    key: "authToken",
    required: true,
    secret: true,
    env: "SMS_AUTH_TOKEN",
    description: "The Twilio auth token; also verifies inbound signatures.",
  },
  {
    key: "fromNumber",
    required: true,
    secret: false,
    env: "SMS_FROM_NUMBER",
    description: "The bot's own E.164 number, used as the sender.",
  },
  {
    key: "publicUrl",
    required: true,
    secret: false,
    env: "SMS_PUBLIC_URL",
    description: "The public URL Twilio posts inbound messages to.",
  },
];

/**
 * The SMS channel on the Twilio backend. Inbound messages arrive by webhook: mount
 * `createWebhookHandler` (see the README); `webhook.handle` verifies against the configured
 * `publicUrl`.
 *
 * `create` validates each value with this package's `ConfigurationError` and makes no network call.
 *
 * @public
 */
export const smsChannel = {
  platform: "sms" as const,
  transport: "webhook" as const,
  webhook: twilioWebhook,
  senderIdentity: { unauthenticated: "the caller id of a text message" },
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): SMSAdapter {
    const [accountSid, authToken, fromNumber, publicUrl] = KEYS.map((k) => readString(config, k));
    const opts = {
      backend: "twilio" as const,
      accountSid: accountSid as string,
      authToken: authToken as string,
      fromNumber: fromNumber as string,
      publicUrl: publicUrl as string,
    };
    const adapter = new SMSAdapter(opts);
    rememberSmsOptions(adapter, opts);
    return adapter;
  },
};
