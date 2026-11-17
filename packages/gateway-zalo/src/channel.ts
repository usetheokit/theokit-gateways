/**
 * `zaloChannel` — the Zalo channel described as data.
 *
 * Typed locally on purpose: this package's peer range on `@theokit/gateway` is a floor, and a
 * published `.d.ts` naming a core type that an older core lacks would break a consumer there. The
 * object is structurally a `ChannelDescriptor`.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { ZaloAdapter } from "./adapter.js";
import type { ZaloFetch } from "./types.js";

const ORIGIN = "gateway-zalo";

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError(ORIGIN, {
    code: "invalid_config",
    message: `${ORIGIN}: config.${key} must be ${expected}`,
    detail: key,
  });
}

function readString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.length === 0) throw invalid(key, "a non-empty string");
  return value;
}

function optionalString(
  config: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, string> {
  const value = config[key];
  if (value === undefined || value === "") return {};
  if (typeof value !== "string") throw invalid(key, "a string");
  return { [key]: value };
}

function optionalFetch(config: Readonly<Record<string, unknown>>): { fetch?: ZaloFetch } {
  const value = config.fetch;
  if (value === undefined) return {};
  if (typeof value !== "function") throw invalid("fetch", "a function");
  return { fetch: value as ZaloFetch };
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly env: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "appId",
    env: "ZALO_APP_ID",
    required: true,
    secret: false,
    description: "The Zalo app id.",
  },
  {
    key: "oaSecretKey",
    env: "ZALO_OA_SECRET_KEY",
    required: true,
    secret: true,
    description: "The Zalo OA secret key; verifies each webhook.",
  },
  {
    key: "accessToken",
    env: "ZALO_ACCESS_TOKEN",
    required: true,
    secret: true,
    description: "A Zalo Official Account access token; it expires and is not refreshed.",
  },
  {
    key: "apiBase",
    env: "ZALO_API_BASE",
    required: false,
    secret: false,
    description: "Override the Open API base, https://openapi.zalo.me.",
  },
];

/**
 * The Zalo channel.
 *
 * The adapter receives signed webhooks and opens no connection of its own, but a webhook
 * descriptor needs a `verify`/`ingest` pair that is a separate piece of work; `transport` is
 * `"socket"` until then, and the app still routes inbound requests to the adapter itself.
 *
 * `create` refuses a missing, empty or non-string value with a `GatewayConfigurationError` coded
 * `invalid_config` that names the key; it performs no network call.
 *
 * @public
 */
export const zaloChannel = {
  platform: "zalo" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): ZaloAdapter {
    return new ZaloAdapter({
      appId: readString(config, "appId"),
      oaSecretKey: readString(config, "oaSecretKey"),
      accessToken: readString(config, "accessToken"),
      ...optionalString(config, "apiBase"),
      ...optionalFetch(config),
    });
  },
};
