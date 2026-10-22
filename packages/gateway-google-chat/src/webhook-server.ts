/**
 * Express webhook route for Google Chat inbound.
 *
 * Every request's bearer token is verified (FR-025) before its body is read as an event: a forged
 * or misdirected token answers 401, a key set that cannot be read answers 503, and neither calls
 * a handler.
 *
 * @public
 */

import { listenerLifecycle, loadPeer, rawBodyCapture } from "@theokit/gateway";
import type { Express, Request, Response } from "express";

import type { GoogleChatInbound } from "./adapter.js";

/** Options for the listener that receives Chat's requests. */
export interface WebhookServerOptions {
  readonly adapter: GoogleChatInbound;
  /** Mount path; default `/google-chat`. */
  readonly path?: string;
  /** Port to listen on when creating its own Express app. Default 3000. */
  readonly port?: number;
  /** Mount on an existing Express app instead; the caller then owns listening. */
  readonly app?: Express;
}

/** A started HTTP listener, with the handle needed to shut it down again. */
export interface WebhookServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

async function loadExpress(): Promise<() => Express> {
  return loadPeer<() => Express>(
    async () => import("express"),
    () => {
      throw new Error(
        'gateway-google-chat: peer-dep "express" not installed. Run: pnpm add express',
      );
    },
  );
}

function handlerFactory(adapter: GoogleChatInbound) {
  return async (req: Request, res: Response): Promise<void> => {
    const answer = await adapter.handleRequest(
      headerOf(req, "authorization"),
      (req as Request & { rawBody?: string }).rawBody ?? "",
    );
    res.status(answer.status).json(answer.body);
  };
}

/**
 * The largest request body the route reads. Chat's interaction events are a few KiB; the route is
 * public, so a body is never held without a bound.
 */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Answer 401 before reading a body when the request carries no bearer token at all: the token
 * check does not depend on the body, so nothing is gained by holding one first.
 */
function refuseWithoutBearer(req: Request, res: Response, next: () => void): void {
  if (/^Bearer \S/.test(headerOf(req, "authorization") ?? "")) {
    next();
    return;
  }
  process.stderr.write("[gateway-google-chat] refused a request (401): no bearer token\n");
  res.status(401).json({ error: "no bearer token" });
}

function headerOf(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Build the HTTP listener that receives Google Chat's requests. Chat dials in, so the endpoint
 * must be reachable over public HTTPS at the URL configured as the app's `audience`. `express` is
 * loaded lazily.
 */
export async function createWebhookServer(opts: WebhookServerOptions): Promise<WebhookServer> {
  const createApp = await loadExpress();
  const app: Express = opts.app ?? createApp();
  const handler = handlerFactory(opts.adapter);
  app.post(
    opts.path ?? "/google-chat",
    refuseWithoutBearer,
    rawBodyCapture("gateway-google-chat", { maxBytes: MAX_BODY_BYTES }),
    (req, res, next) => {
      handler(req, res).catch(next);
    },
  );
  return listenerLifecycle({ app, port: opts.port ?? 3000, injected: opts.app !== undefined });
}
