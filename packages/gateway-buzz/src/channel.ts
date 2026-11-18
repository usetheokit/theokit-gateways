/**
 * `buzzChannel` — the channel described as data, with environment bindings.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` must not name core types an older peer lacks.
 */

import { channelConfigReaders } from "@theokit/gateway";
import { BuzzAdapter } from "./adapter.js";

type Config = Readonly<Record<string, unknown>>;

const readers = channelConfigReaders("gateway-buzz");

function readDelay(config: Config): number | undefined {
  const value = config.reconnectDelayMs;
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  throw readers.invalid("reconnectDelayMs", "a non-negative number or a digit string");
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
    env: "BUZZ_BASE_URL",
    description: "Base URL of the server, e.g. https://chat.example.com.",
  },
  {
    key: "token",
    required: true,
    secret: true,
    env: "BUZZ_TOKEN",
    description: "The bot token for this bot.",
  },
  {
    key: "workspaceId",
    required: true,
    secret: false,
    env: "BUZZ_WORKSPACE_ID",
    description: "Id of the workspace whose realtime stream the adapter follows.",
  },
  {
    key: "botUserId",
    required: true,
    secret: false,
    env: "BUZZ_BOT_USER_ID",
    description: "User id of the bot; events it authored are ignored.",
  },
  {
    key: "reconnectDelayMs",
    required: false,
    secret: false,
    env: "BUZZ_RECONNECT_DELAY_MS",
    description: "Milliseconds to wait before reopening a dropped socket.",
  },
];

/**
 * The channel: it opens its own realtime socket in `connect()`, so it needs no webhook route.
 *
 * `create` refuses a missing or wrongly typed value with `GatewayConfigurationError` (prefix `gateway-buzz`)
 * (code `invalid_config`, the key in the message); it performs no network call. A number or
 * a digit string is accepted for `reconnectDelayMs`.
 *
 * @public
 */
export const buzzChannel = {
  platform: "buzz" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): BuzzAdapter {
    const delay = readDelay(config);
    return new BuzzAdapter({
      baseUrl: readers.requiredString(config, "baseUrl"),
      token: readers.requiredString(config, "token"),
      workspaceId: readers.requiredString(config, "workspaceId"),
      botUserId: readers.requiredString(config, "botUserId"),
      ...(delay === undefined ? {} : { reconnectDelayMs: delay }),
    });
  },
};
