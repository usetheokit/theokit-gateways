/**
 * `zaloChannel` — the Zalo Official Account channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` naming a core type must not break a consumer on an older peer floor.
 */

import { channelConfigReaders } from "@theokit/gateway";

import { ZaloAdapter } from "./adapter.js";

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

const { requiredString } = channelConfigReaders("gateway-zalo");

const webhook = {
  methods: ["POST"] as const,
  /** The `X-ZEvent-Signature` check `handleWebhook` makes; needs no connection. */
  verify(adapter: ZaloAdapter, request: WebhookIn): boolean {
    const entry = Object.entries(request.headers).find(
      ([name]) => name.toLowerCase() === "x-zevent-signature",
    );
    return adapter.verifyWebhook(request.rawBody, entry?.[1]);
  },
  ingest: (adapter: ZaloAdapter, payload: unknown) => adapter.ingestPayload(payload),
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
      appId: requiredString(config, "appId"),
      oaSecretKey: requiredString(config, "oaSecretKey"),
      accessToken: requiredString(config, "accessToken"),
    });
  },
};
