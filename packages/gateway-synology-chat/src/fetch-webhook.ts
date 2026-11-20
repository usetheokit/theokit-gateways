/**
 * The Synology Chat half of the descriptor's webhook, answered through `ChannelWebhook.handle` so
 * a host mounts it with `createWebhookHandler`.
 *
 * `handle` runs the adapter's own `handleCallback`, so the token check and statuses are the ones
 * the Express route gives (400 missing token, 401 wrong token, 503 not connected or no handler).
 * The bot token is recorded by the descriptor's `create`, keyed by the adapter; an adapter the
 * descriptor did not build has none. No token or body text is logged or answered.
 */

import type { SynologyChatAdapter } from "./adapter.js";
import { tokensMatch } from "./token.js";

const tokens = new WeakMap<object, string>();

/** Record the bot token of an adapter the descriptor built. */
export function rememberSynologyToken(adapter: object, botToken: string): void {
  tokens.set(adapter, botToken);
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

function contentTypeOf(headers: Readonly<Record<string, string | undefined>>): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "content-type") return value;
  }
  return undefined;
}

/** The token of a form or JSON body, or `undefined` when none can be read. */
function tokenOf(request: WebhookRequestShape): string | undefined {
  const type = contentTypeOf(request.headers) ?? "";
  if (type.includes("json")) {
    try {
      const parsed: unknown = JSON.parse(request.rawBody);
      const token = (parsed as { token?: unknown } | null)?.token;
      return typeof token === "string" ? token : undefined;
    } catch {
      return undefined;
    }
  }
  return new URLSearchParams(request.rawBody).get("token") ?? undefined;
}

/** The webhook half of the Synology Chat descriptor. */
export const synologyChatWebhook = {
  methods: ["POST"] as const,
  /** The outgoing-webhook token in the body, compared in constant time; needs no connection. */
  verify(adapter: SynologyChatAdapter, request: WebhookRequestShape): boolean {
    const expected = tokens.get(adapter);
    const received = tokenOf(request);
    if (expected === undefined || received === undefined || received.length === 0) return false;
    return tokensMatch(expected, received);
  },
  /** A parsed payload gets the bot token and goes through the same path as `handle`. */
  async ingest(
    adapter: SynologyChatAdapter,
    payload: unknown,
  ): Promise<"delivered" | "malformed" | "no_handler"> {
    const token = tokens.get(adapter);
    if (token === undefined || payload === null || typeof payload !== "object") {
      return "malformed";
    }
    const answer = await adapter.handleCallback(
      "application/json",
      JSON.stringify({ ...payload, token }),
    );
    if (answer.status === 200) return "delivered";
    return answer.status === 503 ? "no_handler" : "malformed";
  },
  async handle(
    adapter: SynologyChatAdapter,
    request: WebhookRequestShape,
  ): Promise<WebhookAnswerShape> {
    const answer = await adapter.handleCallback(contentTypeOf(request.headers), request.rawBody);
    return {
      status: answer.status,
      body: JSON.stringify(answer.body),
      contentType: "application/json",
    };
  },
};
