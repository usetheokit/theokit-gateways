/**
 * Express webhook server for LINE inbound.
 *
 * Validates `X-Line-Signature` (HMAC-SHA256 over raw body) BEFORE
 * parsing/dispatch — 401 on missing or invalid (D408).
 *
 * @public
 */

import type { Express, NextFunction, Request, Response } from "express";

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

async function loadExpress(): Promise<{ default: () => Express }> {
  try {
    const mod = await import("express");
    const fn = (mod as { default?: () => Express }).default ?? (mod as unknown as () => Express);
    return { default: fn };
  } catch {
    throw new ConfigurationError({
      code: "express_not_installed",
      message: 'gateway-line: peer-dep "express" not installed. Run: pnpm add express',
    });
  }
}

function rawCapture(req: Request, _res: Response, next: NextFunction): void {
  // Someone else already drained the stream — a global `express.json()` or
  // `express.urlencoded()` mounted ahead of this router is the usual cause.
  // Without this branch, `req.on("end")` never fires for a stream that already
  // ended, `next()` is never called, and the request HANGS with no response at
  // all: the provider times out and retries, and no error is logged anywhere.
  // Failing loudly and continuing is strictly better — verification then
  // refuses the empty body with a 401, which is at least a visible symptom that
  // points at the real cause.
  if (req.readableEnded || req.complete) {
    process.stderr.write(
      "[gateway] raw body already consumed before signature capture — mount this router " +
        "BEFORE any global body parser, or signature verification cannot see the bytes it " +
        "must hash\n",
    );
    (req as Request & { rawBody: string }).rawBody = "";
    next();
    return;
  }
  let buf = "";
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    buf += chunk;
  });
  req.on("end", () => {
    (req as Request & { rawBody: string }).rawBody = buf;
    next();
  });
  req.on("error", (err) => next(err));
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
  const expressMod = await loadExpress();
  const app: Express = opts.app ?? expressMod.default();
  const path = opts.path ?? "/line";
  app.post(path, rawCapture, handlerFactory(opts.adapter));

  let server: import("node:http").Server | undefined;
  let started = false;
  let stopped = false;

  return {
    async start(): Promise<void> {
      if (started || opts.app !== undefined) {
        started = true;
        return;
      }
      // Cleared here, not in stop(): a server that was stopped and is starting again is no longer
      // stopped, and leaving the flag latched made the NEXT stop() a no-op that left the listener up.
      stopped = false;
      const port = opts.port ?? 3000;
      await new Promise<void>((resolve) => {
        server = app.listen(port, () => resolve());
      });
      started = true;
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      // The pair of latches used to be write-once, so `start()` after a `stop()` returned without
      // creating a listener and the server was silently dead — no error, no log, just a port nothing
      // answers on. Resetting `started` is what makes a restart a restart.
      started = false;
      if (server === undefined) return;
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
      server = undefined;
    },
  };
}
