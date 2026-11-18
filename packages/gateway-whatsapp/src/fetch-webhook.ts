/**
 * The Cloud half of the WhatsApp descriptor's webhook: Meta's GET subscription check and the signed
 * POST, answered through `ChannelWebhook.handle` so a host mounts it with `createWebhookHandler`.
 *
 * The credentials the route needs (`appSecret`, `verifyToken`) are not adapter options, so the
 * descriptor's `create` records them here, keyed by the adapter it built, never on a public field.
 * An adapter not built by the descriptor has none and every request to it is refused.
 *
 * No secret, signature or body text is logged or answered.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import type { WhatsAppAdapter } from "./adapter.js";
import { verifyWebhookSignature } from "./backend/cloud/signature.js";
import type { MetaWebhookEnvelope } from "./backend/cloud/types.js";

/** The webhook credentials of one Cloud adapter. */
interface CloudWebhookConfig {
  readonly appSecret: string;
  readonly verifyToken?: string;
}

const configs = new WeakMap<object, CloudWebhookConfig>();

/** Record the credentials of an adapter the descriptor built. */
export function rememberWebhookConfig(adapter: object, config: CloudWebhookConfig): void {
  configs.set(adapter, config);
}

/** The request shape `handle` receives (structural; the core type is not imported). */
export interface WebhookRequestShape {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly method?: string;
  readonly url?: string;
}

/** What `handle` answers. */
export interface WebhookAnswerShape {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
}

type Outcome = "ok" | "no_handler" | "handler_threw";

function headerValue(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/** Constant-time string equality: both sides are hashed to a fixed length first. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Same mapping as the core's `statusForDeliver`, kept local so the older peer floor still loads. */
function statusFor(outcomes: ReadonlyArray<Outcome>): 200 | 500 | 503 {
  let status: 200 | 500 | 503 = 200;
  for (const outcome of outcomes) {
    if (outcome === "handler_threw") status = 500;
    else if (outcome === "no_handler" && status === 200) status = 503;
  }
  return status;
}

function signatureValid(adapter: object, request: WebhookRequestShape): boolean {
  const config = configs.get(adapter);
  if (config === undefined || config.appSecret.trim().length === 0) return false;
  const header = headerValue(request.headers, "x-hub-signature-256");
  return verifyWebhookSignature(request.rawBody, header, config.appSecret);
}

/** The subscription challenge for a valid GET, `undefined` for anything else. */
function subscriptionChallenge(adapter: object, request: WebhookRequestShape): string | undefined {
  const expected = configs.get(adapter)?.verifyToken;
  if (expected === undefined || expected.length === 0 || request.url === undefined) {
    return undefined;
  }
  let params: URLSearchParams;
  try {
    params = new URL(request.url).searchParams;
  } catch {
    return undefined;
  }
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (params.get("hub.mode") !== "subscribe" || token === null || !safeEqual(token, expected)) {
    return undefined;
  }
  return challenge === null || challenge.length === 0 ? undefined : challenge;
}

/** One check for both methods; a missing method (or a GET without a URL) fails closed. */
function requestValid(adapter: object, request: WebhookRequestShape): boolean {
  const method = request.method?.toUpperCase();
  if (method === "GET") return subscriptionChallenge(adapter, request) !== undefined;
  if (method === "POST") return signatureValid(adapter, request);
  return false;
}

function isEnvelope(payload: unknown): payload is MetaWebhookEnvelope {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload);
}

async function deliverEnvelope(
  adapter: WhatsAppAdapter,
  payload: unknown,
): Promise<"delivered" | "malformed" | "no_handler"> {
  const outcomes = await deliverAll(adapter, payload);
  if (outcomes === undefined) return "malformed";
  return statusFor(outcomes) === 200 ? "delivered" : "no_handler";
}

async function deliverAll(
  adapter: WhatsAppAdapter,
  payload: unknown,
): Promise<Outcome[] | undefined> {
  if (!isEnvelope(payload)) return undefined;
  const outcomes: Outcome[] = [];
  for (const event of adapter.toDeliverableEvents(payload)) {
    outcomes.push(await adapter.deliverQuietly(event));
  }
  return outcomes;
}

/** The webhook half of the Cloud descriptor. */
export const cloudWebhook = {
  methods: ["GET", "POST"] as const,
  verify(adapter: WhatsAppAdapter, request: WebhookRequestShape): boolean {
    return requestValid(adapter, request);
  },
  async ingest(
    adapter: WhatsAppAdapter,
    payload: unknown,
  ): Promise<"delivered" | "malformed" | "no_handler"> {
    return deliverEnvelope(adapter, payload);
  },
  async handle(
    adapter: WhatsAppAdapter,
    request: WebhookRequestShape,
  ): Promise<WebhookAnswerShape> {
    const isGet = request.method?.toUpperCase() === "GET";
    if (!requestValid(adapter, request)) return { status: isGet ? 403 : 401 };
    if (isGet) {
      return {
        status: 200,
        body: subscriptionChallenge(adapter, request) as string,
        contentType: "text/plain",
      };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(request.rawBody);
    } catch {
      return { status: 400 };
    }
    const outcomes = await deliverAll(adapter, payload);
    if (outcomes === undefined) return { status: 400 };
    return { status: statusFor(outcomes) };
  },
};
