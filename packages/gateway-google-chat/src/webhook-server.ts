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
  app.post(opts.path ?? "/google-chat", rawBodyCapture("gateway-google-chat"), (req, res, next) => {
    handler(req, res).catch(next);
  });
  return listenerLifecycle({ app, port: opts.port ?? 3000, injected: opts.app !== undefined });
}
