/**
 * `emailChannel` — the email channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, and the integration
 * package's typecheck is where a drift between the two fails. The package has no error class of
 * its own, so a refused value throws the core `GatewayConfigurationError` tagged `gateway-email`.
 */

import { channelConfigReaders } from "@theokit/gateway";

import { EmailAdapter } from "./adapter.js";
import type { EmailCursorStore } from "./types.js";

const readers = channelConfigReaders("gateway-email");
const { invalid, isAbsent } = readers;

type Config = Readonly<Record<string, unknown>>;

/** `configFromEnv` yields strings, so these readers also take the string forms. */
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value.trim())) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

const read = {
  string: readers.requiredString,
  optionalString: readers.readString,
  boolean(config: Config, key: string): boolean | undefined {
    const value = config[key];
    if (isAbsent(value)) return undefined;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw invalid(key, 'a boolean or the string "true" or "false"');
  },
  number(config: Config, key: string): number | undefined {
    const value = config[key];
    if (isAbsent(value)) return undefined;
    const parsed = toFiniteNumber(value);
    if (parsed !== undefined) return parsed;
    throw invalid(key, "a number or a digit string");
  },
  list(config: Config, key: string): string[] | undefined {
    const value = config[key];
    if (isAbsent(value)) return undefined;
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

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
  readonly env?: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "address",
    required: true,
    secret: false,
    description: "Email address the bot listens on; also the From address of outbound mail.",
    env: "EMAIL_ADDRESS",
  },
  {
    key: "password",
    required: true,
    secret: true,
    description: "Password or app password for the IMAP and SMTP login.",
    env: "EMAIL_PASSWORD",
  },
  {
    key: "imapHost",
    required: true,
    secret: false,
    description: "IMAP server host name.",
    env: "EMAIL_IMAP_HOST",
  },
  {
    key: "imapPort",
    required: false,
    secret: false,
    description: "IMAP server port.",
    env: "EMAIL_IMAP_PORT",
  },
  {
    key: "smtpHost",
    required: true,
    secret: false,
    description: "SMTP server host name.",
    env: "EMAIL_SMTP_HOST",
  },
  {
    key: "smtpPort",
    required: false,
    secret: false,
    description: "SMTP server port.",
    env: "EMAIL_SMTP_PORT",
  },
  {
    key: "fromName",
    required: false,
    secret: false,
    description: "Display name for outbound mail.",
    env: "EMAIL_FROM_NAME",
  },
  {
    key: "allowedSenders",
    required: false,
    secret: false,
    description: "Sender addresses allowed through, as a list or comma-separated string.",
    env: "EMAIL_ALLOWED_SENDERS",
  },
  {
    key: "allowAutomated",
    required: false,
    secret: false,
    description: "When true, automated senders (no-reply, bulk mail) are not filtered out.",
    env: "EMAIL_ALLOW_AUTOMATED",
  },
  {
    key: "pollIntervalMs",
    required: false,
    secret: false,
    description: "Milliseconds between mailbox polls.",
    env: "EMAIL_POLL_INTERVAL_MS",
  },
  {
    key: "maxBodyChars",
    required: false,
    secret: false,
    description: "Longest inbound body kept, in characters.",
    env: "EMAIL_MAX_BODY_CHARS",
  },
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
