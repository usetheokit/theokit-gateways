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

function requiredString(config: Config, key: string): string {
  const value = config[key];
  if (typeof value !== "string") throw invalid(key, "a string");
  // The adapter's own check for an empty value throws a plain TypeError, which `createChannels`
  // would rethrow as a defect instead of reporting the channel as rejected.
  if (value.length === 0) throw invalid(key, "a non-empty string");
  return value;
}

function optionalString(config: Config, key: string): string | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw invalid(key, "a string");
  return value;
}

/** An optional boolean, as a boolean or the strings `"true"` / `"false"`. */
function optionalBoolean(config: Config, key: string): boolean | undefined {
  const value = config[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
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
    const clientId = requiredString(config, "clientId");
    const clientSecret = requiredString(config, "clientSecret");
    const tenantId = requiredString(config, "tenantId");
    const botDisplayName = optionalString(config, "botDisplayName");
    const requireMention = optionalBoolean(config, "requireMention");
    const options: TeamsAdapterOptions = {
      clientId,
      clientSecret,
      tenantId,
      ...(botDisplayName === undefined ? {} : { botDisplayName }),
      ...(requireMention === undefined ? {} : { requireMention }),
    };
    return new TeamsAdapter(options);
  },
};
