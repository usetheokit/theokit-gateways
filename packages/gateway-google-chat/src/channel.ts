/**
 * `googleChatChannel` — the Google Chat channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { readFileSync } from "node:fs";

import { GatewayConfigurationError } from "@theokit/gateway";

import { GoogleChatAdapter } from "./adapter.js";
import type { GoogleChatAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway-google-chat", {
    code: "invalid_config",
    message: `gateway-google-chat: config.${key} must be ${expected}`,
    detail: key,
  });
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** An optional string: `undefined`, `null` and `""` are absent. */
function optionalString(config: Config, key: string): string | undefined {
  const value = config[key];
  if (isAbsent(value)) return undefined;
  if (typeof value !== "string") throw invalid(key, "a string");
  return value;
}

function requiredString(config: Config, key: string): string {
  const value = optionalString(config, key);
  if (value === undefined) throw invalid(key, "a non-empty string");
  return value;
}

function optionalWebhook(config: Config): "listener" | "external" | undefined {
  const value = config.webhook;
  if (isAbsent(value)) return undefined;
  if (value === "listener" || value === "external") return value;
  throw invalid("webhook", '"listener" or "external"');
}

interface Credentials {
  readonly serviceAccountEmail: string;
  readonly privateKey: string;
}

/** `client_email` and `private_key` of a service account JSON key file; invalid_config naming the file. */
function readKeyFile(path: string): Credentials {
  const fail = (why: string): GatewayConfigurationError =>
    new GatewayConfigurationError("gateway-google-chat", {
      code: "invalid_config",
      message: `gateway-google-chat: config.serviceAccountFile ${path} ${why}`,
      detail: "serviceAccountFile",
    });
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw fail("cannot be read as a JSON file");
  }
  const record =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const { client_email: email, private_key: key } = record;
  if (typeof email !== "string" || email === "" || typeof key !== "string" || key === "") {
    throw fail("must hold string client_email and private_key fields");
  }
  return { serviceAccountEmail: email, privateKey: key };
}

function readCredentials(config: Config): Credentials {
  const email = optionalString(config, "serviceAccountEmail");
  const privateKey = optionalString(config, "privateKey");
  const file = optionalString(config, "serviceAccountFile");
  if (email !== undefined && privateKey !== undefined) {
    return { serviceAccountEmail: email, privateKey };
  }
  if (file === undefined) {
    const missing = email === undefined ? "serviceAccountEmail" : "privateKey";
    throw invalid(missing, "a non-empty string (or give serviceAccountFile)");
  }
  const fromFile = readKeyFile(file);
  return {
    serviceAccountEmail: email ?? fromFile.serviceAccountEmail,
    privateKey: privateKey ?? fromFile.privateKey,
  };
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
    key: "serviceAccountEmail",
    required: true,
    secret: false,
    env: "GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL",
    description: "The Chat app's service account email; read from serviceAccountFile when absent.",
  },
  {
    key: "privateKey",
    required: true,
    secret: true,
    env: "GOOGLE_CHAT_PRIVATE_KEY",
    description: "The service account's PEM private key; read from serviceAccountFile when absent.",
  },
  {
    key: "serviceAccountFile",
    required: false,
    secret: false,
    env: "GOOGLE_CHAT_SERVICE_ACCOUNT_FILE",
    description:
      "Path to the service account JSON key; supplies client_email and private_key when those fields are absent.",
  },
  {
    key: "audience",
    required: true,
    secret: false,
    env: "GOOGLE_CHAT_AUDIENCE",
    description:
      "The Chat app's HTTP endpoint URL; inbound tokens must carry exactly this audience.",
  },
  {
    key: "webhook",
    required: false,
    secret: false,
    env: "GOOGLE_CHAT_WEBHOOK",
    description:
      '"listener" (default) opens the webhook listener in connect(); "external" opens none and the host routes requests to handleRequest().',
  },
];

/** The `file` variant: the credentials come from the JSON key at `serviceAccountFile`. */
const FILE_CONFIG: ReadonlyArray<ConfigField> = CONFIG.map((field) =>
  field.key === "serviceAccountFile" ? { ...field, required: true } : field,
).filter((field) => field.key !== "serviceAccountEmail" && field.key !== "privateKey");

/**
 * The Google Chat channel: `connect()` opens its own webhook listener, unless `webhook` is
 * `"external"`.
 *
 * Credentials come from `serviceAccountEmail` and `privateKey`, or from the JSON key at
 * `serviceAccountFile` for whichever of the two is absent. `create` refuses a value of the wrong
 * type, and a key file it cannot read, with a `GatewayConfigurationError` coded `invalid_config`;
 * it performs no network call.
 */
const inlineChannel = {
  platform: "google_chat" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): GoogleChatAdapter {
    const audience = requiredString(config, "audience");
    const webhook = optionalWebhook(config);
    const credentials = readCredentials(config);
    const options: GoogleChatAdapterOptions = {
      ...credentials,
      audience,
      ...(webhook === undefined ? {} : { webhook }),
    };
    return new GoogleChatAdapter(options);
  },
};

/**
 * The Google Chat channel. The descriptor itself is the `inline` shape (`serviceAccountEmail` and
 * `privateKey` required); `selectVariant(googleChatChannel, "file")` is the shape that requires
 * `serviceAccountFile` instead. `create` serves both.
 *
 * @public
 */
export const googleChatChannel = {
  ...inlineChannel,
  variants: {
    inline: inlineChannel,
    file: { ...inlineChannel, config: FILE_CONFIG },
  },
};
