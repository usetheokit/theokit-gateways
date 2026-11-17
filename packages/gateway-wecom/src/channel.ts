/**
 * `wecomChannel` — the WeCom channel described as data. Typed locally on purpose: this package's
 * peer range on `@theokit/gateway` is a floor, and a published `.d.ts` must not name a core type
 * a consumer on that floor lacks.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { WeComAdapter } from "./adapter.js";

const PREFIX = "gateway-wecom";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError(PREFIX, {
    code: "invalid_config",
    message: `${PREFIX}: config.${key} must be ${expected}`,
    detail: key,
  });
}

function readString(config: Config, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.length === 0) throw invalid(key, "a non-empty string");
  return value;
}

/** The agent id as a number or a digit string. */
function readAgentId(config: Config, key: string): number {
  const value = config[key];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw invalid(key, "a number or a digit string");
  return parsed;
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
    key: "corpId",
    required: true,
    secret: false,
    env: "WECOM_CORP_ID",
    description: "The WeCom corp id.",
  },
  {
    key: "corpSecret",
    required: true,
    secret: true,
    env: "WECOM_CORP_SECRET",
    description: "The self-built application's Secret.",
  },
  {
    key: "agentId",
    required: true,
    secret: false,
    env: "WECOM_AGENT_ID",
    description: "The self-built application's AgentId, a number or a digit string.",
  },
  {
    key: "token",
    required: true,
    secret: true,
    env: "WECOM_TOKEN",
    description: "The callback Token you chose.",
  },
  {
    key: "encodingAesKey",
    required: true,
    secret: true,
    env: "WECOM_ENCODING_AES_KEY",
    description: "The callback EncodingAESKey (43 characters).",
  },
];

/**
 * The WeCom channel. `create` validates every value and throws a `GatewayConfigurationError`
 * coded `invalid_config` naming the key; it performs no network call. Inbound callbacks reach the
 * adapter through `handleWebhook`, routed by the app.
 *
 * @public
 */
export const wecomChannel = {
  platform: "wecom" as const,
  transport: "socket" as const,
  config: CONFIG,
  create(config: Config): WeComAdapter {
    return new WeComAdapter({
      corpId: readString(config, "corpId"),
      corpSecret: readString(config, "corpSecret"),
      agentId: readAgentId(config, "agentId"),
      token: readString(config, "token"),
      encodingAesKey: readString(config, "encodingAesKey"),
    });
  },
};
