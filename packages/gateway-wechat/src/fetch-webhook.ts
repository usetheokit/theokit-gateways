/**
 * The WeChat half of the descriptor's webhook, answered through `ChannelWebhook.handle` so a host
 * mounts it with `createWebhookHandler`.
 *
 * WeChat signs the query string (`signature`, `timestamp`, `nonce`), so the signature is read from
 * `request.url`. The token is recorded here by the descriptor's `create`, keyed by the adapter, so
 * no secret sits on a public field; an adapter the descriptor did not build has none and every
 * request to it is refused. The adapter's own `handleWebhook` makes the delivery and its status and
 * body are answered unchanged (a 503 stays 503, so WeChat retries).
 *
 * No secret, signature or body text is logged or answered.
 */

import type { WeChatAdapter, WeChatWebhookRequest } from "./adapter.js";
import { verifyWeChatSignature } from "./signature.js";

const tokens = new WeakMap<object, string>();

/** Record the callback token of an adapter the descriptor built. */
export function rememberWeChatToken(adapter: object, token: string): void {
  tokens.set(adapter, token);
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

/** The query WeChat signs, read from a URL; `undefined` when the URL is absent or unparseable. */
function queryOf(url: string | undefined): WeChatWebhookRequest | undefined {
  if (url === undefined) return undefined;
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return undefined;
  }
  const signature = params.get("signature") ?? params.get("msg_signature");
  const timestamp = params.get("timestamp");
  const nonce = params.get("nonce");
  const echostr = params.get("echostr");
  return {
    ...(signature === null ? {} : { signature }),
    ...(timestamp === null ? {} : { timestamp }),
    ...(nonce === null ? {} : { nonce }),
    ...(echostr === null ? {} : { echostr }),
  };
}

function verified(token: string | undefined, query: WeChatWebhookRequest | undefined): boolean {
  return token !== undefined && query !== undefined && verifyWeChatSignature(token, query);
}

/** The webhook half of the WeChat descriptor. */
export const wechatWebhook = {
  methods: ["GET", "POST"] as const,
  /** The query signature `handle` checks; needs no connection. */
  verify(adapter: WeChatAdapter, request: WebhookRequestShape): boolean {
    return verified(tokens.get(adapter), queryOf(request.url));
  },
  /** A payload `{ query, rawBody? }` goes through the adapter, which verifies it again. */
  async ingest(
    adapter: WeChatAdapter,
    payload: unknown,
  ): Promise<"delivered" | "malformed" | "no_handler"> {
    if (payload === null || typeof payload !== "object") return "malformed";
    const { query, rawBody } = payload as { query?: unknown; rawBody?: unknown };
    if (query === null || typeof query !== "object" || typeof rawBody !== "string") {
      return "malformed";
    }
    const answer = await adapter.handleWebhook(query as WeChatWebhookRequest, rawBody);
    if (answer.status === 200) return "delivered";
    return answer.status === 503 ? "no_handler" : "malformed";
  },
  async handle(adapter: WeChatAdapter, request: WebhookRequestShape): Promise<WebhookAnswerShape> {
    const query = queryOf(request.url);
    if (!verified(tokens.get(adapter), query) || query === undefined) return { status: 401 };
    const isGet = request.method?.toUpperCase() === "GET";
    const answer = await adapter.handleWebhook(query, isGet ? undefined : request.rawBody);
    return { status: answer.status, body: answer.body, contentType: "text/plain; charset=utf-8" };
  },
};
