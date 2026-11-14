/**
 * `createWebhookHandler` — one Fetch `Request` to `Response` handler for every webhook channel.
 *
 * It routes by platform, caps the body, and answers with the descriptor's `handle`, or runs verify,
 * JSON.parse and ingest. No secret, header value or body reaches `onError` or a response.
 */

import type { BasePlatformAdapter } from "../adapter/base.js";
import type {
  ChannelWebhook,
  WebhookAnswer,
  WebhookRequest,
} from "../channel/channel-descriptor.js";
import type { BuiltChannel } from "../channel/create-channels.js";
import type { PlatformName } from "../types/message-event.js";
import { DEFAULT_WEBHOOK_MAX_BYTES } from "./express-server.js";

/** Options for `createWebhookHandler`. */
export interface WebhookHandlerOptions {
  /** The built channels; only those with `transport: "webhook"` are routed. */
  readonly channels: ReadonlyArray<BuiltChannel>;
  /** Whether the platform's runner has started; a platform that has not answers 503. */
  readonly isStarted: (platform: PlatformName) => boolean;
  /** Body cap in bytes. Default 1 MiB. */
  readonly maxBodyBytes?: number;
  /** Default: the last path segment after `/webhooks/`. */
  readonly platformFor?: (url: URL) => PlatformName | undefined;
  /** Called when a handle/ingest throws; the response is 500 with no body. */
  readonly onError?: (platform: PlatformName, error: unknown) => void;
}

const TOO_LARGE = Symbol("too-large");

function defaultPlatformFor(url: URL): PlatformName | undefined {
  const marker = "/webhooks/";
  const at = url.pathname.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = url.pathname.slice(at + marker.length).replace(/\/+$/, "");
  const last = rest.split("/").pop();
  return last ? (last as PlatformName) : undefined;
}

function plain(status: number, extra?: Record<string, string>): Response {
  return new Response(null, { status, headers: extra });
}

function tooLarge(): Response {
  return plain(413, { connection: "close" });
}

async function readCapped(request: Request, max: number): Promise<string | typeof TOO_LARGE> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > max) return TOO_LARGE;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function answerResponse(answer: WebhookAnswer): Response {
  const headers: Record<string, string> = {};
  if (answer.contentType !== undefined) headers["content-type"] = answer.contentType;
  return new Response(answer.body ?? null, { status: answer.status, headers });
}

async function runDefault(
  webhook: ChannelWebhook<BasePlatformAdapter>,
  adapter: BasePlatformAdapter,
  request: WebhookRequest,
): Promise<Response> {
  if (!webhook.verify(adapter, request)) return plain(401);
  let payload: unknown;
  try {
    payload = JSON.parse(request.rawBody);
  } catch {
    return plain(400);
  }
  const result = await webhook.ingest(adapter, payload);
  if (result === "delivered") return plain(200);
  return plain(result === "no_handler" ? 503 : 400);
}

function headersOf(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function readBody(request: Request, max: number): Promise<string | Response> {
  let body: string | typeof TOO_LARGE;
  try {
    body = await readCapped(request, max);
  } catch {
    return plain(400);
  }
  return body === TOO_LARGE ? tooLarge() : body;
}

/**
 * Build a Fetch handler for every `transport: "webhook"` channel in `channels`: 404 for an unknown
 * platform, 503 while it has not started, 405 for a method the route does not take, 413 past the
 * body cap, 400 for an unreadable body, and 500 with no body when a route throws.
 */
export function createWebhookHandler(
  options: WebhookHandlerOptions,
): (request: Request) => Promise<Response> {
  const max = options.maxBodyBytes ?? DEFAULT_WEBHOOK_MAX_BYTES;
  const platformFor = options.platformFor ?? defaultPlatformFor;
  const routes = new Map<PlatformName, BuiltChannel>();
  for (const channel of options.channels) {
    if (channel.descriptor.transport === "webhook")
      routes.set(channel.descriptor.platform, channel);
  }
  const route = (url: URL): BuiltChannel | undefined => {
    const platform = platformFor(url);
    return platform === undefined ? undefined : routes.get(platform);
  };
  return async (request) => {
    const channel = route(new URL(request.url));
    if (channel === undefined) return plain(404);
    const platform = channel.descriptor.platform;
    if (!options.isStarted(platform)) return plain(503);
    const webhook = channel.descriptor.webhook as ChannelWebhook<BasePlatformAdapter>;
    const refused = refuseMethod(webhook, request);
    if (refused !== undefined) return refused;
    const rawBody = await readBody(request, max);
    if (typeof rawBody !== "string") return rawBody;
    try {
      return await dispatch(webhook, channel.adapter, {
        rawBody,
        headers: headersOf(request),
        method: request.method.toUpperCase(),
        url: request.url,
      });
    } catch (error) {
      options.onError?.(platform, error);
      return plain(500);
    }
  };
}

function refuseMethod(
  webhook: ChannelWebhook<BasePlatformAdapter>,
  request: Request,
): Response | undefined {
  const methods = webhook.methods ?? ["POST"];
  const method = request.method.toUpperCase();
  if (methods.some((m) => m.toUpperCase() === method)) return undefined;
  return plain(405, { allow: methods.join(", ") });
}

async function dispatch(
  webhook: ChannelWebhook<BasePlatformAdapter>,
  adapter: BasePlatformAdapter,
  request: WebhookRequest,
): Promise<Response> {
  if (webhook.handle !== undefined) return answerResponse(await webhook.handle(adapter, request));
  return runDefault(webhook, adapter, request);
}
