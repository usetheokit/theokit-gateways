/**
 * `yuanbaoChannel` — the Tencent Yuanbao bot channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` naming a core type must not break a consumer on an older peer floor.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { YuanbaoAdapter } from "./adapter.js";

/** The request a descriptor receives (typed locally). */
type WebhookIn = {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
};

const CONFIG = [
  {
    key: "appId",
    required: true,
    secret: false,
    env: "YUANBAO_APP_ID",
    description: "The bot's app id.",
  },
  {
    key: "appSecret",
    required: true,
    secret: true,
    env: "YUANBAO_APP_SECRET",
    description: "The bot's app secret; exchanged for an access token.",
  },
  {
    key: "callbackSecret",
    required: true,
    secret: true,
    env: "YUANBAO_CALLBACK_SECRET",
    description: "The callback signing secret; verifies inbound callbacks.",
  },
];

/** A non-empty string config value; anything else is a `gateway-yuanbao` configuration error. */
function requiredString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new GatewayConfigurationError("gateway-yuanbao", {
    code: "invalid_config",
    message: `gateway-yuanbao: config.${key} must be a non-empty string`,
    detail: key,
  });
}

/** Drops absent header values so `Headers` (case-insensitive) can take the rest. */
function definedHeaders(headers: WebhookIn["headers"]): [string, string][] {
  return Object.entries(headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]]));
}

const webhook = {
  methods: ["POST"] as const,
  /** The signature and timestamp check `handleWebhook` makes; needs no connection. */
  verify(adapter: YuanbaoAdapter, request: WebhookIn): boolean {
    const headers = new Headers(definedHeaders(request.headers));
    return adapter.verifyWebhook(
      request.rawBody,
      headers.get("x-signature") ?? undefined,
      headers.get("x-timestamp") ?? undefined,
    );
  },
  ingest: (adapter: YuanbaoAdapter, payload: unknown) => adapter.ingestPayload(payload),
};

/**
 * The Yuanbao channel. Inbound callbacks arrive by webhook: mount `createWebhookHandler` (see the
 * README); `webhook.verify` checks the `x-signature` and `x-timestamp` headers.
 *
 * `create` validates each value and makes no network call.
 *
 * @public
 */
export const yuanbaoChannel = {
  platform: "yuanbao" as const,
  transport: "webhook" as const,
  webhook,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): YuanbaoAdapter {
    return new YuanbaoAdapter({
      appId: requiredString(config, "appId"),
      appSecret: requiredString(config, "appSecret"),
      callbackSecret: requiredString(config, "callbackSecret"),
    });
  },
};
