/**
 * `qqChannel` — the QQ Bot channel described as data.
 *
 * Typed locally on purpose: the object is structurally a `ChannelDescriptor`, but a published
 * `.d.ts` naming a core type must not break a consumer on an older peer floor.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { QQAdapter } from "./adapter.js";

/** A webhook request, shaped like the core's `WebhookRequest` (typed locally). */
interface WebhookRequestShape {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

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

function readString(config: Readonly<Record<string, unknown>>, key: string): string {
  const value = config[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  const message = `gateway-qq: config.${key} must be a non-empty string`;
  throw new GatewayConfigurationError("gateway-qq", {
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
  /** The Ed25519 check `handleWebhook` makes for an event; needs no connection. */
  verify(adapter: QQAdapter, request: WebhookRequestShape): boolean {
    return adapter.verifyWebhook(
      request.rawBody,
      header(request, "x-signature-ed25519"),
      header(request, "x-signature-timestamp"),
    );
  },
  async ingest(
    adapter: QQAdapter,
    payload: unknown,
  ): Promise<"delivered" | "malformed" | "no_handler"> {
    return adapter.ingestPayload(payload);
  },
  /**
   * Full control of one request: QQ's callback URL validation (`op` 13) is unsigned and expects
   * the signed `plain_token` back as JSON, so it cannot go through `verify`.
   */
  async handle(adapter: QQAdapter, request: WebhookRequestShape): Promise<WebhookAnswerShape> {
    const answer = await adapter.handleWebhook(
      request.rawBody,
      header(request, "x-signature-ed25519"),
      header(request, "x-signature-timestamp"),
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
      appId: readString(config, "appId"),
      appSecret: readString(config, "appSecret"),
    });
  },
};
