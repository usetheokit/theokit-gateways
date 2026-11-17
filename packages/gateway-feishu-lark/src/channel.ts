/**
 * `feishuLarkChannel` — the Feishu/Lark channel described as data, with environment bindings.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` must not name core types an older peer lacks.
 */

import { FeishuLarkAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";

type Config = Readonly<Record<string, unknown>>;

const APP_ID = /^cli_[0-9a-f]{16}$/i;

function invalid(key: string, expected: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-feishu-lark: config.${key} must be ${expected}`,
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

function readAppId(config: Config): string {
  const appId = readString(config, "appId");
  // The adapter throws a plain Error for this, which createChannels would rethrow as a defect.
  if (!APP_ID.test(appId)) throw invalid("appId", "cli_ followed by 16 hex characters");
  return appId;
}

function readDomain(config: Config): "feishu" | "lark" | undefined {
  const value = config.domain;
  if (value === undefined || value === null) return undefined;
  if (value === "feishu" || value === "lark") return value;
  throw invalid("domain", '"feishu" or "lark"');
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
    key: "appId",
    required: true,
    secret: false,
    env: "FEISHU_LARK_APP_ID",
    description: "The custom app's id: cli_ followed by 16 hex characters.",
  },
  {
    key: "appSecret",
    required: true,
    secret: true,
    env: "FEISHU_LARK_APP_SECRET",
    description: "The custom app's secret from the open platform console.",
  },
  {
    key: "domain",
    required: false,
    secret: false,
    env: "FEISHU_LARK_DOMAIN",
    description: 'Open platform to use: "feishu" (default) or "lark".',
  },
];

/**
 * The Feishu/Lark channel: it opens its own long connection in `connect()`, so it needs no
 * webhook route.
 *
 * `create` refuses a missing or wrongly typed value, a malformed `appId` and an unknown `domain`
 * with this package's `ConfigurationError` (code `invalid_config`, the key in the message); it
 * performs no network call.
 *
 * @public
 */
export const feishuLarkChannel = {
  platform: "feishu_lark" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): FeishuLarkAdapter {
    const domain = readDomain(config);
    return new FeishuLarkAdapter({
      appId: readAppId(config),
      appSecret: readString(config, "appSecret"),
      ...(domain === undefined ? {} : { domain }),
    });
  },
};
