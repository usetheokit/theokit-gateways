/**
 * `yuanbaoChannel` — the Tencent Yuanbao bot channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` naming a core type must not break a consumer on an older peer floor.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { YuanbaoAdapter } from "./adapter.js";

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly env: string;
  readonly description: string;
}

/** A webhook request, shaped like the core's `WebhookRequest` (typed locally). */
interface WebhookRequestShape {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

const CONFIG: ReadonlyArray<ConfigField> = [
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

function readString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GatewayConfigurationError("gateway-yuanbao", {
      code: "invalid_config",
      message: `gateway-yuanbao: config.${key} must be a non-empty string`,
      detail: key,
    });
  }
  return value;
}

/** The header `name` (lower case), looked up without regard to the case of the request's keys. */
function header(request: WebhookRequestShape, name: string): string | undefined {
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

const webhook = {
  methods: ["POST"] as const,
  /** The signature and timestamp check `handleWebhook` makes; needs no connection. */
  verify(adapter: YuanbaoAdapter, request: WebhookRequestShape): boolean {
    return adapter.verifyWebhook(
      request.rawBody,
      header(request, "x-signature"),
      header(request, "x-timestamp"),
    );
  },
  async ingest(
    adapter: YuanbaoAdapter,
    payload: unknown,
  ): Promise<"delivered" | "malformed" | "no_handler"> {
    return adapter.ingestPayload(payload);
  },
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
      appId: readString(config, "appId"),
      appSecret: readString(config, "appSecret"),
      callbackSecret: readString(config, "callbackSecret"),
    });
  },
};
