/**
 * The Nextcloud Talk half of the descriptor's webhook, answered through `ChannelWebhook.handle` so
 * a host mounts it with `createWebhookHandler`.
 *
 * `handle` runs the adapter's own `handleRequest`, so the checks and statuses are the ones the
 * Express route gives. The bot secret is recorded by the descriptor's `create`, keyed by the
 * adapter, so no secret sits on a public field; an adapter the descriptor did not build has none
 * and every request to it is refused. No secret, signature or body text is logged or answered.
 */

import { randomBytes } from "node:crypto";

import type { NextcloudTalkAdapter } from "./adapter.js";
import { talkSignature, verifyTalkSignature } from "./signature.js";

const secrets = new WeakMap<object, string>();

/** Record the secret of an adapter the descriptor built. */
export function rememberTalkSecret(adapter: object, secret: string): void {
  secrets.set(adapter, secret);
}

export interface WebhookRequestShape {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly method?: string;
  readonly url?: string;
}

export interface WebhookAnswerShape {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
}

function headerOf(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

function talkHeaders(request: WebhookRequestShape) {
  return {
    random: headerOf(request.headers, "x-nextcloud-talk-random"),
    signature: headerOf(request.headers, "x-nextcloud-talk-signature"),
  };
}

/** The webhook half of the Nextcloud Talk descriptor. */
export const nextcloudTalkWebhook = {
  methods: ["POST"] as const,
  /** Talk's signature over the random and the raw body; needs no connection. */
  verify(adapter: NextcloudTalkAdapter, request: WebhookRequestShape): boolean {
    const secret = secrets.get(adapter);
    if (secret === undefined) return false;
    const { random, signature } = talkHeaders(request);
    return verifyTalkSignature(secret, random, request.rawBody, signature);
  },
  /** A parsed payload is signed with the bot secret and answered by the same path as `handle`. */
  async ingest(
    adapter: NextcloudTalkAdapter,
    payload: unknown,
  ): Promise<"delivered" | "malformed" | "no_handler"> {
    const secret = secrets.get(adapter);
    if (secret === undefined || payload === null || typeof payload !== "object") {
      return "malformed";
    }
    const rawBody = JSON.stringify(payload);
    const random = randomBytes(32).toString("hex");
    const answer = await adapter.handleRequest(
      { random, signature: talkSignature(secret, random, rawBody) },
      rawBody,
    );
    if (answer.status === 200) return "delivered";
    return answer.status === 503 ? "no_handler" : "malformed";
  },
  async handle(
    adapter: NextcloudTalkAdapter,
    request: WebhookRequestShape,
  ): Promise<WebhookAnswerShape> {
    const answer = await adapter.handleRequest(talkHeaders(request), request.rawBody);
    return {
      status: answer.status,
      body: JSON.stringify(answer.body),
      contentType: "application/json",
    };
  },
};
