/**
 * `wecomChannel` — the WeCom (WeChat Work) channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type an older release lacks would break a consumer on that floor. The object
 * is structurally a `ChannelDescriptor`; the integration package assigns it to one.
 */

import { channelConfigReaders } from "@theokit/gateway";

import { WeComAdapter } from "./adapter.js";
import { rememberWeComToken, wecomWebhook } from "./fetch-webhook.js";
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

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "corpId",
    required: true,
    secret: false,
    env: "WECOM_CORP_ID",
    description: "The enterprise CorpID.",
  },
  {
    key: "corpSecret",
    required: true,
    secret: true,
    env: "WECOM_CORP_SECRET",
    description: "The self-built application's secret.",
  },
  {
    key: "agentId",
    required: true,
    secret: false,
    env: "WECOM_AGENT_ID",
    description: "The self-built application's AgentId, a number or a string of digits.",
  },
  {
    key: "token",
    required: true,
    secret: true,
    env: "WECOM_TOKEN",
    description: "The token configured for the application's callback, used to verify signatures.",
  },
  {
    key: "encodingAesKey",
    required: true,
    secret: true,
    env: "WECOM_ENCODING_AES_KEY",
    description: "The 43-character EncodingAESKey configured for the application's callback.",
  },
];

/**
 * The WeCom channel. Callbacks arrive by webhook: mount `createWebhookHandler` (see the README);
 * `webhook.handle` verifies the query signature and answers the callback-URL check.
 *
 * `create` refuses a value of the wrong type with a `GatewayConfigurationError` coded
 * `invalid_config` and performs no network call.
 *
 * @public
 */
export const wecomChannel = {
  platform: "wecom" as const,
  transport: "webhook" as const,
  webhook: wecomWebhook,
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
    const adapter = new WeComAdapter(options);
    rememberWeComToken(adapter, options.token);
    return adapter;
  },
};
