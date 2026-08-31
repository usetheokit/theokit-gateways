/**
 * Express webhook server for LINE inbound.
 *
 * Validates `X-Line-Signature` (HMAC-SHA256 over raw body) BEFORE
 * parsing/dispatch — 401 on missing or invalid (D408).
 *
 * @public
 */

import { listenerLifecycle, loadPeer, rawBodyCapture } from "@theokit/gateway";
import type { Express, Request, Response } from "express";
import type { LineAdapter } from "./adapter.js";

import { ConfigurationError } from "./errors.js";
import { verifyLineSignature } from "./signature.js";
import type { LineWebhookEnvelope } from "./types.js";

export interface WebhookServerOptions {
  readonly adapter: LineAdapter;
  /** Mount path; default `/line`. */
  readonly path?: string;
  /** Port to listen on when creating own Express app. Default 3000. */
  readonly port?: number;
  /** Inject an existing Express app. */
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
      throw new ConfigurationError({
        code: "express_not_installed",
        message: 'gateway-line: peer-dep "express" not installed. Run: pnpm add express',
      });
    },
  );
}

function handlerFactory(adapter: LineAdapter) {
  return (req: Request, res: Response): void => {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? "";
    const signature = headerOf(req, "x-line-signature");
    if (!verifyLineSignature(adapter.getChannelSecret(), rawBody, signature)) {
      res.status(401).type("text/plain").send("invalid signature");
      return;
    }
    let envelope: LineWebhookEnvelope;
    try {
      envelope = JSON.parse(rawBody) as LineWebhookEnvelope;
    } catch {
      res.status(400).type("text/plain").send("invalid JSON body");
      return;
    }
    if (!Array.isArray(envelope.events)) {
      res.status(400).type("text/plain").send("missing 'events' array");
      return;
    }
    // Answered before dispatch, on purpose: LINE retries a webhook it did not see a 200 for,
    // and waiting on the handler turns a slow one into a duplicate delivery. What that costs is
    // that the dispatch is floated — and a floated rejection is an unhandled one, which ends the
    // process (the defect fixed across the other adapters in #41). The catch is what makes the
    // early answer safe rather than merely fast.
    void adapter.dispatchWebhookBody(envelope).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway-line] webhook dispatch failed: ${message}\n`);
    });
    // LINE expects a 200 OK quickly to ack the webhook.
    res.status(200).end();
  };
}

function headerOf(req: Request, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(",") : v;
}

/**
 * Build the HTTP listener that receives LINE's webhook deliveries.
 *
 * LINE dials in, so this endpoint must be reachable over public HTTPS and registered in the LINE
 * console — unlike the connection-based adapters, inbound cannot work behind a firewall. `express`
 * is loaded lazily, so a project that only sends messages never pays for it.
 */
export async function createWebhookServer(opts: WebhookServerOptions): Promise<WebhookServer> {
  const createApp = await loadExpress();
  const app: Express = opts.app ?? createApp();
  const path = opts.path ?? "/line";
  app.post(path, rawBodyCapture("gateway-line"), handlerFactory(opts.adapter));

  // The lifecycle — and the latches that make a restart a restart — live in `@theokit/gateway`,
  // written once. They were duplicated here and in gateway-sms, and the same write-once bug had to
  // be fixed in both files by one commit, which is what made the duplication a defect (#89).
  return listenerLifecycle({ app, port: opts.port ?? 3000, injected: opts.app !== undefined });
}
