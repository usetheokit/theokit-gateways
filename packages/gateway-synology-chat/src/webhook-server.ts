/**
 * The Express route Synology Chat posts a bot's outgoing callbacks to.
 *
 * The body is read raw, at most 1 MiB, and handed to the adapter, which checks the token before it
 * reads anything else.
 *
 * @public
 */

import { listenerLifecycle, loadPeer, rawBodyCapture } from "@theokit/gateway";
import type { Express, Request, Response } from "express";

/** What the route needs from the adapter. */
export interface SynologyChatInbound {
  handleCallback(
    contentType: string | undefined,
    rawBody: string,
  ): Promise<{ readonly status: number; readonly body: Record<string, unknown> }>;
}

/** Options for the callback listener. */
export interface WebhookServerOptions {
  readonly adapter: SynologyChatInbound;
  readonly path?: string;
  readonly port?: number;
  readonly app?: Express;
}

/** A started HTTP listener, with the handle needed to shut it down again. */
export interface WebhookServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** A callback is a short form; the route is public, so an unsigned body is not held unbounded. */
const MAX_BODY_BYTES = 1024 * 1024;

async function loadExpress(): Promise<() => Express> {
  return loadPeer<() => Express>(
    async () => import("express"),
    () => {
      throw new Error(
        'gateway-synology-chat: peer-dep "express" not installed. Run: pnpm add express',
      );
    },
  );
}

/** Build the listener at the Outgoing URL configured for the bot. `express` is loaded lazily. */
export async function createWebhookServer(opts: WebhookServerOptions): Promise<WebhookServer> {
  const createApp = await loadExpress();
  const app: Express = opts.app ?? createApp();
  app.post(
    opts.path ?? "/synology-chat",
    rawBodyCapture("gateway-synology-chat", { maxBytes: MAX_BODY_BYTES }),
    (req, res, next) => {
      opts.adapter
        .handleCallback(
          req.headers["content-type"],
          (req as Request & { rawBody?: string }).rawBody ?? "",
        )
        .then((answer) => {
          (res as Response).status(answer.status).json(answer.body);
        })
        .catch(next);
    },
  );
  return listenerLifecycle({ app, port: opts.port ?? 3000, injected: opts.app !== undefined });
}
