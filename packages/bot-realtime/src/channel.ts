/**
 * The channel descriptor shared by the ClickClack and Buzz gateways: the same four required
 * strings and an optional reconnect delay, with environment bindings.
 *
 * Typed locally on purpose: the result is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` must not name core types an older peer lacks.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import type { RealtimeBotOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
export interface RealtimeBotConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
  readonly env: string;
}

const FIELDS: ReadonlyArray<readonly [string, boolean, string, string]> = [
  ["baseUrl", false, "BASE_URL", "Base URL of the server, e.g. https://chat.example.com."],
  ["token", true, "TOKEN", "The bot token for this bot."],
  [
    "workspaceId",
    false,
    "WORKSPACE_ID",
    "Id of the workspace whose realtime stream the adapter follows.",
  ],
  ["botUserId", false, "BOT_USER_ID", "User id of the bot; events it authored are ignored."],
];

/** The descriptor of a realtime-bot platform. */
export interface RealtimeBotChannel<A> {
  readonly platform: string;
  readonly transport: "socket";
  readonly senderIdentity: "authenticated";
  readonly config: ReadonlyArray<RealtimeBotConfigField>;
  create(config: Readonly<Record<string, unknown>>): A;
}

/** Builds the descriptor of a realtime-bot platform; `build` constructs its adapter. */
export function realtimeBotChannel<A>(
  pkg: string,
  platform: string,
  envPlatform: string,
  build: (options: RealtimeBotOptions) => A,
): RealtimeBotChannel<A> {
  const invalid = (key: string, expected: string) =>
    new GatewayConfigurationError(pkg, {
      code: "invalid_config",
      message: `${pkg}: config.${key} must be ${expected}`,
      detail: key,
    });
  const str = (config: Config, key: string): string => {
    const value = config[key];
    if (typeof value !== "string" || value === "") throw invalid(key, "a non-empty string");
    return value;
  };
  const readDelay = (config: Config): number | undefined => {
    const value = config.reconnectDelayMs;
    if (value === undefined) return undefined;
    const parsed = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
    if (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0) return parsed;
    throw invalid("reconnectDelayMs", "a non-negative number or a digit string");
  };
  const fields: RealtimeBotConfigField[] = FIELDS.map(([key, secret, suffix, description]) => ({
    key,
    required: true,
    secret,
    env: `${envPlatform}_${suffix}`,
    description,
  }));
  fields.push({
    key: "reconnectDelayMs",
    required: false,
    secret: false,
    env: `${envPlatform}_RECONNECT_DELAY_MS`,
    description: "Milliseconds to wait before reopening a dropped socket.",
  });
  return {
    platform,
    transport: "socket" as const,
    senderIdentity: "authenticated" as const,
    config: fields as ReadonlyArray<RealtimeBotConfigField>,
    create(config: Config): A {
      const delay = readDelay(config);
      return build({
        baseUrl: str(config, "baseUrl"),
        token: str(config, "token"),
        workspaceId: str(config, "workspaceId"),
        botUserId: str(config, "botUserId"),
        ...(delay === undefined ? {} : { reconnectDelayMs: delay }),
      });
    },
  };
}
