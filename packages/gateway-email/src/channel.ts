/**
 * `emailChannel` — the email channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, and the integration
 * package's typecheck is where a drift between the two fails. The package has no error class of
 * its own, so a refused value throws the core `GatewayConfigurationError` tagged `gateway-email`.
 */

import { channelConfigReaders } from "@theokit/gateway";

import { type ConfigField, field } from "../../../shared/channel-config-field.js";
import { envValueReaders } from "../../../shared/env-value-readers.js";
import { EmailAdapter } from "./adapter.js";
import type { EmailCursorStore } from "./types.js";

const readers = channelConfigReaders("gateway-email");
const { invalid } = readers;

/** Only `undefined` is absent: `null` and `""` are wrong shapes and throw `invalid_config`. */
const isAbsent = (value: unknown): boolean => value === undefined;

type Config = Readonly<Record<string, unknown>>;

/** Readers for values that may arrive as env strings; only `undefined` is absent. */
const read = {
  ...envValueReaders(invalid),
  string: readers.requiredString,
  optionalString: (config: Config, key: string): string | undefined =>
    config[key] === undefined ? undefined : readers.requiredString(config, key),
  list(config: Config, key: string): string[] | undefined {
    const value = config[key];
    if (value === undefined) return undefined;
    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
    throw invalid(key, "an array of strings or a comma-separated string");
  },
};

function readCursorStore(config: Readonly<Record<string, unknown>>): EmailCursorStore | undefined {
  const value = config.cursorStore;
  if (isAbsent(value)) return undefined;
  const store = value as Partial<EmailCursorStore> | null;
  if (
    typeof value !== "object" ||
    typeof store?.load !== "function" ||
    typeof store.save !== "function"
  ) {
    throw invalid("cursorStore", "an object with load and save functions");
  }
  return value as EmailCursorStore;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  field(
    "address",
    "EMAIL_ADDRESS",
    "Email address the bot listens on; also the From address of outbound mail.",
  ),
  field("password", "EMAIL_PASSWORD", "Password or app password for the IMAP and SMTP login.", {
    secret: true,
  }),
  field("imapHost", "EMAIL_IMAP_HOST", "IMAP server host name."),
  field("imapPort", "EMAIL_IMAP_PORT", "IMAP server port.", { required: false }),
  field("smtpHost", "EMAIL_SMTP_HOST", "SMTP server host name."),
  field("smtpPort", "EMAIL_SMTP_PORT", "SMTP server port.", { required: false }),
  field("fromName", "EMAIL_FROM_NAME", "Display name for outbound mail.", { required: false }),
  field(
    "allowedSenders",
    "EMAIL_ALLOWED_SENDERS",
    "Sender addresses allowed through, as a list or comma-separated string.",
    { required: false },
  ),
  field(
    "allowAutomated",
    "EMAIL_ALLOW_AUTOMATED",
    "When true, automated senders (no-reply, bulk mail) are not filtered out.",
    { required: false },
  ),
  field("pollIntervalMs", "EMAIL_POLL_INTERVAL_MS", "Milliseconds between mailbox polls.", {
    required: false,
  }),
  field("maxBodyChars", "EMAIL_MAX_BODY_CHARS", "Longest inbound body kept, in characters.", {
    required: false,
  }),
  {
    key: "cursorStore",
    required: false,
    secret: false,
    description: "Programmatic store that persists the IMAP cursor; no env binding.",
  },
];

/**
 * The email channel: the adapter polls IMAP itself, so it needs no webhook route. A From header is
 * written by the sender, so `sender.id` is not authenticated.
 *
 * `create` validates each value and throws `GatewayConfigurationError` (`invalid_config`) naming
 * the key; it makes no network call.
 *
 * @public
 */
export const emailChannel = {
  platform: "email" as const,
  transport: "socket" as const,
  senderIdentity: {
    unauthenticated: "an email From header is written by the sender and can be forged",
  },
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): EmailAdapter {
    const address = read.string(config, "address");
    const password = read.string(config, "password");
    const imapHost = read.string(config, "imapHost");
    const smtpHost = read.string(config, "smtpHost");
    const imapPort = read.number(config, "imapPort");
    const smtpPort = read.number(config, "smtpPort");
    const fromName = read.optionalString(config, "fromName");
    const allowedSenders = read.list(config, "allowedSenders");
    const allowAutomated = read.boolean(config, "allowAutomated");
    const pollIntervalMs = read.number(config, "pollIntervalMs");
    const maxBodyChars = read.number(config, "maxBodyChars");
    const cursorStore = readCursorStore(config);
    return new EmailAdapter({
      address,
      password,
      imapHost,
      smtpHost,
      ...(imapPort === undefined ? {} : { imapPort }),
      ...(smtpPort === undefined ? {} : { smtpPort }),
      ...(fromName === undefined ? {} : { fromName }),
      ...(allowedSenders === undefined ? {} : { allowedSenders }),
      ...(allowAutomated === undefined ? {} : { allowAutomated }),
      ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
      ...(maxBodyChars === undefined ? {} : { maxBodyChars }),
      ...(cursorStore === undefined ? {} : { cursorStore }),
    });
  },
};
