/**
 * Express webhook route for Nextcloud Talk bot webhooks.
 *
 * Every request's signature is checked (FR-037) against the raw bytes `rawBodyCapture` keeps,
 * before the body is read as an event: a missing header or a mismatch answers 401 and calls no
 * handler.
 *
 * @public
 */

import { listenerLifecycle, loadPeer, rawBodyCapture } from "@theokit/gateway";
import type { Express, Request, Response } from "express";

import type { NextcloudTalkInbound } from "./adapter.js";

/** Options for the listener that receives Talk's webhooks. */
export interface WebhookServerOptions {
  readonly adapter: NextcloudTalkInbound;
  /** Mount path; default `/nextcloud-talk`. */
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
        'gateway-nextcloud-talk: peer-dep "express" not installed. Run: pnpm add express',
      );
    },
  );
}

/**
 * The largest webhook body the route reads. A Talk message is at most 32000 code points, under
 * 128 KiB as UTF-8 inside its JSON envelope; the route is public, so a body nobody signed is not
 * held without a bound.
 */
const MAX_BODY_BYTES = 1024 * 1024;

function headerOf(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Build the HTTP listener that receives Talk's webhooks, at the URL given to
 * `occ talk:bot:install`. `express` is loaded lazily.
 */
export async function createWebhookServer(opts: WebhookServerOptions): Promise<WebhookServer> {
  const createApp = await loadExpress();
  const app: Express = opts.app ?? createApp();
  app.post(
    opts.path ?? "/nextcloud-talk",
    rawBodyCapture("gateway-nextcloud-talk", { maxBytes: MAX_BODY_BYTES }),
    (req, res, next) => {
      opts.adapter
        .handleRequest(
          {
            random: headerOf(req, "x-nextcloud-talk-random"),
            signature: headerOf(req, "x-nextcloud-talk-signature"),
          },
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
