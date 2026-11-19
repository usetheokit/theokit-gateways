/**
 * `zaloChannel` — the Zalo Official Account channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` naming a core type must not break a consumer on an older peer floor.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { ZaloAdapter } from "./adapter.js";

/** A webhook request, shaped like the core's `WebhookRequest` (typed locally). */
interface WebhookRequestShape {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

const CONFIG = [
  {
    key: "appId",
    required: true,
    secret: false,
    env: "ZALO_APP_ID",
    description: "The Zalo app id; part of the signed string.",
  },
  {
    key: "oaSecretKey",
    required: true,
    secret: true,
    env: "ZALO_OA_SECRET_KEY",
    description: "The OA secret key; verifies inbound webhooks.",
  },
  {
    key: "accessToken",
    required: true,
    secret: true,
    env: "ZALO_OA_ACCESS_TOKEN",
    description: "The OA access token; used to send messages.",
  },
];

function readString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  const message = `gateway-zalo: config.${key} must be a non-empty string`;
  throw new GatewayConfigurationError("gateway-zalo", {
    code: "invalid_config",
    message,
    detail: key,
  });
}

/** The header `name` (lower case), looked up without regard to the case of the request's keys. */
function header(request: WebhookRequestShape, name: string): string | undefined {
  const hit = Object.keys(request.headers).find((key) => key.toLowerCase() === name);
  return hit === undefined ? undefined : request.headers[hit];
}

const webhook = {
  methods: ["POST"] as const,
  /** The `X-ZEvent-Signature` check `handleWebhook` makes; needs no connection. */
  verify(adapter: ZaloAdapter, request: WebhookRequestShape): boolean {
    return adapter.verifyWebhook(request.rawBody, header(request, "x-zevent-signature"));
  },
  async ingest(
    adapter: ZaloAdapter,
    payload: unknown,
  ): Promise<"delivered" | "malformed" | "no_handler"> {
    return adapter.ingestPayload(payload);
  },
};

/**
 * The Zalo Official Account channel. Inbound events arrive by webhook: mount
 * `createWebhookHandler` (see the README); `webhook.verify` checks `X-ZEvent-Signature`.
 *
 * `create` validates each value and makes no network call.
 *
 * @public
 */
export const zaloChannel = {
  platform: "zalo" as const,
  transport: "webhook" as const,
  webhook,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): ZaloAdapter {
    return new ZaloAdapter({
      appId: readString(config, "appId"),
      oaSecretKey: readString(config, "oaSecretKey"),
      accessToken: readString(config, "accessToken"),
    });
  },
};
