/**
 * The WeCom half of the descriptor's webhook, answered through `ChannelWebhook.handle` so a host
 * mounts it with `createWebhookHandler`.
 *
 * WeCom signs the query (`msg_signature`, `timestamp`, `nonce`) together with the encrypted payload:
 * the `echostr` on the GET check, the XML `Encrypt` element on a POST. The token is recorded here by
 * the descriptor's `create`, keyed by the adapter, so no secret sits on a public field; an adapter
 * the descriptor did not build has none and every request to it is refused. The adapter's own
 * `handleWebhook` decrypts and delivers, and its status and body are answered unchanged (a 503
 * stays 503, so WeCom retries).
 *
 * No secret, signature or body text is logged or answered.
 */

import type { WeComAdapter, WeComWebhookRequest } from "./adapter.js";
import { verifyWeComSignature } from "./crypto.js";
import { parseWeComXml } from "./xml.js";

const tokens = new WeakMap<object, string>();

/** Record the callback token of an adapter the descriptor built. */
export function rememberWeComToken(adapter: object, token: string): void {
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

/** The query WeCom signs, read from a URL; `undefined` when the URL is absent or unparseable. */
function queryOf(url: string | undefined): WeComWebhookRequest | undefined {
  if (url === undefined) return undefined;
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return undefined;
  }
  const signature = params.get("msg_signature") ?? params.get("signature");
  const timestamp = params.get("timestamp");
  const nonce = params.get("nonce");
  const echostr = params.get("echostr");
  return {
    ...(signature === null ? {} : { msg_signature: signature }),
    ...(timestamp === null ? {} : { timestamp }),
    ...(nonce === null ? {} : { nonce }),
    ...(echostr === null ? {} : { echostr }),
  };
}

/** The encrypted value the signature covers, or `undefined` when there is none. */
function encryptedOf(query: WeComWebhookRequest, rawBody: string | undefined): string | undefined {
  if (rawBody === undefined) return query.echostr;
  try {
    return parseWeComXml(rawBody).Encrypt;
  } catch {
    return undefined;
  }
}

function verified(
  token: string | undefined,
  query: WeComWebhookRequest | undefined,
  rawBody: string | undefined,
): boolean {
  if (token === undefined || query === undefined) return false;
  const encrypted = encryptedOf(query, rawBody);
  return (
    encrypted !== undefined && encrypted !== "" && verifyWeComSignature(token, query, encrypted)
  );
}

/** The webhook half of the WeCom descriptor. */
export const wecomWebhook = {
  methods: ["GET", "POST"] as const,
  /** The signature `handle` checks (a request with a body is judged as a POST). */
  verify(adapter: WeComAdapter, request: WebhookRequestShape): boolean {
    const isGet = request.method?.toUpperCase() === "GET";
    return verified(tokens.get(adapter), queryOf(request.url), isGet ? undefined : request.rawBody);
  },
  /** A payload `{ query, rawBody }` goes through the adapter, which verifies it again. */
  async ingest(
    adapter: WeComAdapter,
    payload: unknown,
  ): Promise<"delivered" | "malformed" | "no_handler"> {
    if (payload === null || typeof payload !== "object") return "malformed";
    const { query, rawBody } = payload as { query?: unknown; rawBody?: unknown };
    if (query === null || typeof query !== "object" || typeof rawBody !== "string") {
      return "malformed";
    }
    const answer = await adapter.handleWebhook(query as WeComWebhookRequest, rawBody);
    if (answer.status === 200) return "delivered";
    return answer.status === 503 ? "no_handler" : "malformed";
  },
  async handle(adapter: WeComAdapter, request: WebhookRequestShape): Promise<WebhookAnswerShape> {
    const query = queryOf(request.url);
    const rawBody = request.method?.toUpperCase() === "GET" ? undefined : request.rawBody;
    if (!verified(tokens.get(adapter), query, rawBody) || query === undefined) {
      return { status: 401 };
    }
    const answer = await adapter.handleWebhook(query, rawBody);
    return { status: answer.status, body: answer.body, contentType: "text/plain; charset=utf-8" };
  },
};
