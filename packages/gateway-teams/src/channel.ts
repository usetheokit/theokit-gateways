/**
 * `teamsChannel` — the Microsoft Teams channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { TeamsAdapter } from "./adapter.js";
import type { TeamsAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway-teams", {
    code: "invalid_config",
    message: `gateway-teams: config.${key} must be ${expected}`,
    detail: key,
  });
}

/** Reads `key` as a string (or boolean); `""`, `null` and `undefined` count as absent. */
function read(config: Config, key: string, required: boolean, boolean = false): unknown {
  const value = config[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw invalid(key, "a non-empty string");
    return undefined;
  }
  if (!boolean) {
    if (typeof value === "string") return value;
    throw invalid(key, "a string");
  }
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "false") return value === "true";
  throw invalid(key, 'a boolean or the string "true" or "false"');
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
    key: "clientId",
    required: true,
    secret: false,
    env: "TEAMS_CLIENT_ID",
    description: "The Azure AD application (client) id of the Teams app registration.",
  },
  {
    key: "clientSecret",
    required: true,
    secret: true,
    env: "TEAMS_CLIENT_SECRET",
    description: "The app registration's client secret.",
  },
  {
    key: "tenantId",
    required: true,
    secret: false,
    env: "TEAMS_TENANT_ID",
    description: "The Azure AD tenant id.",
  },
  {
    key: "botDisplayName",
    required: false,
    secret: false,
    env: "TEAMS_BOT_DISPLAY_NAME",
    description: "The bot's display name, a fallback for mention stripping.",
  },
  {
    key: "requireMention",
    required: false,
    secret: false,
    env: "TEAMS_REQUIRE_MENTION",
    description: "Deliver a group or channel message only when it mentions the bot. Default true.",
  },
];

/**
 * The Teams channel: the SDK listens for `POST /api/messages` once `connect()` runs.
 *
 * `create` refuses a value of the wrong type with a `GatewayConfigurationError` coded
 * `invalid_config` and performs no network call.
 *
 * @public
 */
export const teamsChannel = {
  platform: "teams" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): TeamsAdapter {
    const str = (key: string, required = false) => read(config, key, required) as string;
    const botDisplayName = str("botDisplayName") as string | undefined;
    const requireMention = read(config, "requireMention", false, true) as boolean | undefined;
    const options: TeamsAdapterOptions = {
      clientId: str("clientId", true),
      clientSecret: str("clientSecret", true),
      tenantId: str("tenantId", true),
      ...(botDisplayName === undefined ? {} : { botDisplayName }),
      ...(requireMention === undefined ? {} : { requireMention }),
    };
    return new TeamsAdapter(options);
  },
};
