/**
 * `qqChannel` — the QQ Bot channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` naming a core type must not break a consumer on an older peer floor.
 */

import { channelConfigReaders } from "@theokit/gateway";

import { QQAdapter } from "./adapter.js";

/** The request a descriptor receives (typed locally). */
type WebhookIn = {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
};

/** An answer, shaped like the core's `WebhookAnswer` (typed locally). */
interface WebhookAnswerShape {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
}

const CONFIG = [
  {
    key: "appId",
    required: true,
    secret: false,
    env: "QQ_APP_ID",
    description: "The bot's AppID.",
  },
  {
    key: "appSecret",
    required: true,
    secret: true,
    env: "QQ_APP_SECRET",
    description: "The bot's AppSecret; derives the signing key and gets the access token.",
  },
];

const { requiredString } = channelConfigReaders("gateway-qq");

/** Drops absent header values so `Headers` (case-insensitive) can take the rest. */
function definedHeaders(headers: WebhookIn["headers"]): [string, string][] {
  return Object.entries(headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]]));
}

const webhook = {
  methods: ["POST"] as const,
  /** The Ed25519 check `handleWebhook` makes for an event; needs no connection. */
  verify(adapter: QQAdapter, request: WebhookIn): boolean {
    const headers = new Headers(definedHeaders(request.headers));
    return adapter.verifyWebhook(
      request.rawBody,
      headers.get("x-signature-ed25519") ?? undefined,
      headers.get("x-signature-timestamp") ?? undefined,
    );
  },
  ingest: (adapter: QQAdapter, payload: unknown) => adapter.ingestPayload(payload),
  /**
   * Full control of one request: QQ's callback URL validation (`op` 13) is unsigned and expects
   * the signed `plain_token` back as JSON, so it cannot go through `verify`.
   */
  async handle(adapter: QQAdapter, request: WebhookIn): Promise<WebhookAnswerShape> {
    const headers = new Headers(definedHeaders(request.headers));
    const answer = await adapter.handleWebhook(
      request.rawBody,
      headers.get("x-signature-ed25519") ?? undefined,
      headers.get("x-signature-timestamp") ?? undefined,
    );
    if (answer.body === undefined) return { status: answer.status };
    return {
      status: answer.status,
      body: JSON.stringify(answer.body),
      contentType: "application/json",
    };
  },
};

/**
 * The QQ Bot channel. Inbound events arrive by webhook: mount `createWebhookHandler` (see the
 * README); `webhook.handle` also answers QQ's callback URL validation.
 *
 * `create` validates each value and makes no network call.
 *
 * @public
 */
export const qqChannel = {
  platform: "qq" as const,
  transport: "webhook" as const,
  webhook,
  config: CONFIG,
  create(config: Readonly<Record<string, unknown>>): QQAdapter {
    return new QQAdapter({
      appId: requiredString(config, "appId"),
      appSecret: requiredString(config, "appSecret"),
    });
  },
};
