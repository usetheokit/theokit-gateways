/**
 * `whatsappChannel` — the WhatsApp channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 *
 * Two variants pick the backend: `cloud` (Meta Cloud API) and `baileys` (WhatsApp Web multi-device).
 * The parent descriptor itself describes the cloud shape; `selectVariant(whatsappChannel, "baileys")`
 * picks the other.
 */

import { WhatsAppAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";
import { cloudWebhook, rememberWebhookConfig } from "./fetch-webhook.js";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-whatsapp: config.${key} must be ${expected}`,
    detail: key,
  });
}

type Kind = "string" | "boolean";

/** Reads `key`; `undefined`, `null` and `""` are absent. A boolean may be the string "true"/"false". */
function read(config: Config, key: string, kind: Kind): string | boolean | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (kind === "string" && typeof value === "string") return value;
  if (kind === "boolean" && typeof value === "boolean") return value;
  if (kind === "boolean" && (value === "true" || value === "false")) return value === "true";
  throw invalid(key, kind === "string" ? "a string" : 'a boolean or the string "true" or "false"');
}

/** A required string; an empty one is left for the adapter's own check, which names it. */
function requiredString(config: Config, key: string): string {
  const value = config[key] === "" ? "" : read(config, key, "string");
  if (typeof value !== "string") throw invalid(key, "a string");
  return value;
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
  readonly env?: string;
}

const REQUIRE_MENTION: ConfigField = {
  key: "requireMention",
  required: false,
  secret: false,
  env: "WHATSAPP_REQUIRE_MENTION",
  description: "Whether group messages must mention the bot. Default true.",
};

const CLOUD_CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "accessToken",
    required: true,
    secret: true,
    env: "WHATSAPP_ACCESS_TOKEN",
    description: "The Meta Cloud API access token.",
  },
  {
    key: "phoneNumberId",
    required: true,
    secret: false,
    env: "WHATSAPP_PHONE_NUMBER_ID",
    description: "The Cloud API phone number id the adapter answers for.",
  },
  {
    key: "appSecret",
    required: true,
    secret: true,
    env: "WHATSAPP_APP_SECRET",
    description: "The Meta app secret that signs inbound webhooks.",
  },
  {
    key: "verifyToken",
    required: false,
    secret: true,
    env: "WHATSAPP_VERIFY_TOKEN",
    description:
      "The token Meta's webhook subscription check sends; the webhook's GET answers 403 without it.",
  },
  REQUIRE_MENTION,
];

const BAILEYS_CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "sessionDir",
    required: true,
    secret: false,
    env: "WHATSAPP_SESSION_DIR",
    description: "Directory where the Baileys session (credentials) is stored.",
  },
  {
    key: "botPhoneId",
    required: false,
    secret: false,
    env: "WHATSAPP_BOT_PHONE_ID",
    description:
      "The bot's own number; with requireMention (default), a group message must mention it or is dropped.",
  },
  REQUIRE_MENTION,
];

function common(config: Config): { requireMention?: boolean; botPhoneId?: string } {
  const requireMention = read(config, "requireMention", "boolean") as boolean | undefined;
  const botPhoneId = read(config, "botPhoneId", "string") as string | undefined;
  return {
    ...(requireMention === undefined ? {} : { requireMention }),
    ...(botPhoneId === undefined ? {} : { botPhoneId }),
  };
}

function createCloud(config: Config): WhatsAppAdapter {
  const accessToken = requiredString(config, "accessToken");
  const phoneNumberId = requiredString(config, "phoneNumberId");
  const appSecret = requiredString(config, "appSecret");
  const verifyToken = read(config, "verifyToken", "string") as string | undefined;
  const opts = common(config);
  const adapter = WhatsAppAdapter.from(
    { backend: "cloud", cloud: { accessToken, phoneNumberId, appSecret } },
    opts,
  );
  rememberWebhookConfig(adapter, {
    appSecret,
    ...(verifyToken === undefined ? {} : { verifyToken }),
  });
  return adapter;
}

/** Runtime dependencies the `baileys` variant's `create` reads as its second argument. */
export interface BaileysChannelDeps {
  /** Where the pairing QR goes; see `BaileysOptions.onQr`. */
  readonly onQr?: (qr: string) => void;
  /** Connect timeout in milliseconds; see `BaileysOptions.connectTimeoutMs`. */
  readonly connectTimeoutMs?: number;
}

function createBaileys(config: Config, deps?: BaileysChannelDeps): WhatsAppAdapter {
  const sessionDir = requiredString(config, "sessionDir");
  const opts = common(config);
  const baileys = {
    sessionDir,
    ...(deps?.onQr === undefined ? {} : { onQr: deps.onQr }),
    ...(deps?.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: deps.connectTimeoutMs }),
  };
  return WhatsAppAdapter.from({ backend: "baileys", baileys }, opts);
}

const cloudChannel = {
  platform: "whatsapp" as const,
  transport: "webhook" as const,
  webhook: cloudWebhook,
  senderIdentity: "authenticated" as const,
  config: CLOUD_CONFIG,
  create: createCloud,
};

const baileysChannel = {
  platform: "whatsapp" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: BAILEYS_CONFIG,
  create: createBaileys,
};

/**
 * The WhatsApp channel. The descriptor itself is the `cloud` shape; `variants.cloud` and
 * `variants.baileys` are the two backends, chosen with `selectVariant`.
 *
 * `create` refuses a value of the wrong type with this package's `ConfigurationError`
 * (`invalid_config`) and performs no network call.
 *
 * @public
 */
export const whatsappChannel = {
  ...cloudChannel,
  variants: { cloud: cloudChannel, baileys: baileysChannel },
};
