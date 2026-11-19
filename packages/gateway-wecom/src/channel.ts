/**
 * `wecomChannel` — the WeCom (WeChat Work) channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { channelConfigReaders } from "@theokit/gateway";

import { WeComAdapter } from "./adapter.js";
import type { WeComAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

const { invalid, requiredString } = channelConfigReaders("gateway-wecom");

/** The agent id: a number or a digit string. */
function readAgentId(config: Config): number | string {
  const value = config.agentId;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)))
    return value;
  throw invalid("agentId", "a non-negative integer or a string of digits");
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
  readonly env?: string;
}

const field = (
  key: string,
  env: string,
  description: string,
  { required = true, secret = false }: { required?: boolean; secret?: boolean } = {},
): ConfigField => ({ key, required, secret, env, description });

const CONFIG: ReadonlyArray<ConfigField> = [
  field("corpId", "WECOM_CORP_ID", "The enterprise CorpID."),
  field("corpSecret", "WECOM_CORP_SECRET", "The self-built application's secret.", {
    secret: true,
  }),
  field(
    "agentId",
    "WECOM_AGENT_ID",
    "The self-built application's AgentId, a number or a string of digits.",
  ),
  field(
    "token",
    "WECOM_TOKEN",
    "The token configured for the application's callback, used to verify signatures.",
    { secret: true },
  ),
  field(
    "encodingAesKey",
    "WECOM_ENCODING_AES_KEY",
    "The 43-character EncodingAESKey configured for the application's callback.",
    { secret: true },
  ),
];

/**
 * The WeCom channel. Callbacks reach the adapter through a route your app mounts
 * (`transport: "socket"` is the constructor-only descriptor shape; the webhook contract is separate).
 *
 * `create` refuses a value of the wrong type with a `GatewayConfigurationError` coded
 * `invalid_config` and performs no network call.
 *
 * @public
 */
export const wecomChannel = {
  platform: "wecom" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): WeComAdapter {
    const options: WeComAdapterOptions = {
      corpId: requiredString(config, "corpId"),
      corpSecret: requiredString(config, "corpSecret"),
      agentId: readAgentId(config),
      token: requiredString(config, "token"),
      encodingAesKey: requiredString(config, "encodingAesKey"),
    };
    return new WeComAdapter(options);
  },
};
