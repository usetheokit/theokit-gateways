/**
 * `clickclackChannel` — the channel described as data, with environment bindings.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` must not name core types an older peer lacks.
 */

import { ClickClackAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-clickclack: config.${key} must be ${expected}`,
    detail: key,
  });
}

function readString(config: Config, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(key, "a non-empty string");
  }
  return value;
}

function readDelay(config: Config): number | undefined {
  const value = config.reconnectDelayMs;
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  throw invalid("reconnectDelayMs", "a non-negative number or a digit string");
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
  readonly env: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "baseUrl",
    required: true,
    secret: false,
    env: "CLICKCLACK_BASE_URL",
    description: "Base URL of the server, e.g. https://chat.example.com.",
  },
  {
    key: "token",
    required: true,
    secret: true,
    env: "CLICKCLACK_TOKEN",
    description: "The bot token for this bot.",
  },
  {
    key: "workspaceId",
    required: true,
    secret: false,
    env: "CLICKCLACK_WORKSPACE_ID",
    description: "Id of the workspace whose realtime stream the adapter follows.",
  },
  {
    key: "botUserId",
    required: true,
    secret: false,
    env: "CLICKCLACK_BOT_USER_ID",
    description: "User id of the bot; events it authored are ignored.",
  },
  {
    key: "reconnectDelayMs",
    required: false,
    secret: false,
    env: "CLICKCLACK_RECONNECT_DELAY_MS",
    description: "Milliseconds to wait before reopening a dropped socket.",
  },
];

/**
 * The channel: it opens its own realtime socket in `connect()`, so it needs no webhook route.
 *
 * `create` refuses a missing or wrongly typed value with this package's `ConfigurationError`
 * (code `invalid_config`, the key in the message); it performs no network call. A number or
 * a digit string is accepted for `reconnectDelayMs`.
 *
 * @public
 */
export const clickclackChannel = {
  platform: "clickclack" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): ClickClackAdapter {
    const delay = readDelay(config);
    return new ClickClackAdapter({
      baseUrl: readString(config, "baseUrl"),
      token: readString(config, "token"),
      workspaceId: readString(config, "workspaceId"),
      botUserId: readString(config, "botUserId"),
      ...(delay === undefined ? {} : { reconnectDelayMs: delay }),
    });
  },
};
