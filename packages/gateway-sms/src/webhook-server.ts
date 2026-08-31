/**
 * `createWebhookServer` — Express helper for inbound SMS webhooks.
 *
 * Registers per-backend routes (`/sms/twilio`, `/sms/plivo`, `/sms/vonage`)
 * each with the matching parser middleware. All three:
 *
 * 1. Read the raw body verbatim (signature verification depends on the
 *    exact bytes — even one extra `\r\n` invalidates the HMAC).
 * 2. Call `adapter.verifySignature(ctx)` → 401 if false.
 * 3. Call `adapter.buildEventFromCtx(ctx)` → `dispatchEvent(event)`.
 * 4. Return 204 No Content.
 *
 * Caller can pass an existing Express app (`opts.app`) or let the helper
 * create one. `start()` / `stop()` are idempotent.
 *
 * @public
 */

import type { Express, NextFunction, Request, Response } from "express";
import type { SMSAdapter } from "./adapter.js";
import type { SignatureContext } from "./backend-types.js";
import { ConfigurationError } from "./errors.js";

export interface WebhookServerOptions {
  readonly adapter: SMSAdapter;
  /** Mount path prefix; default `"/sms"`. The full path is `${path}/${backend}`. */
  readonly path?: string;
  /** Listen port. Ignored when `app` is provided. Default `3000`. */
  readonly port?: number;
  /** Inject an existing Express app instead of creating one. */
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
    // Both ESM and CJS forms; normalize to { default }.
    const fn = (mod as { default?: () => Express }).default ?? (mod as unknown as () => Express);
    return { default: fn };
  } catch {
    throw new ConfigurationError({
      code: "express_not_installed",
      message: 'gateway-sms: peer-dep "express" not installed. Run: pnpm add express',
    });
  }
}

/**
 * The URL the provider signed.
 *
 * `publicUrl` wins when it is configured, because it is the only value that survives a proxy. The
 * provider verifies against the address IT posted to, and behind a tunnel, an ingress, or a load
 * balancer terminating TLS the reconstruction below yields the internal one — so a correct
 * signature fails, on every delivery, with nothing in the log naming the cause.
 *
 * The header reconstruction stays as the fallback: an app served directly has nothing to configure
 * and the headers are the truth. Measured 2026-08-31 — `publicUrl` is required by all three backend
 * option shapes and documented as "used by signature verifier", and until this commit no source
 * file read it.
 */
function signedUrl(
  req: Request,
  headers: Readonly<Record<string, string>>,
  publicUrl?: string,
): string {
  if (publicUrl !== undefined && publicUrl !== "") return publicUrl;
  const protoHeader = headers["x-forwarded-proto"];
  const proto = protoHeader ?? (req.secure ? "https" : "http");
  const host = req.get("host") ?? "localhost";
  return `${proto}://${host}${req.originalUrl}`;
}

function buildSignatureContext(req: Request, publicUrl?: string): SignatureContext {
  const rawBody = (req as Request & { rawBody?: string }).rawBody ?? "";
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : (v ?? "");
  }
  return { headers, rawBody, url: signedUrl(req, headers, publicUrl) };
}

/**
 * Build the HTTP listener that receives the provider's inbound-SMS callbacks.
 *
 * The provider dials in, so this endpoint must be reachable over public HTTPS and registered in the
 * provider console — inbound cannot work behind a firewall. `express` is loaded lazily, so a project
 * that only sends messages never pays for it.
 */
export async function createWebhookServer(opts: WebhookServerOptions): Promise<WebhookServer> {
  const expressMod = await loadExpress();
  const app: Express = opts.app ?? expressMod.default();
  const prefix = opts.path ?? "/sms";
  const backend = opts.adapter.getBackendKind();

  // Raw-body capture middleware — must run BEFORE express.urlencoded/json,
  // since signature verification needs the exact byte sequence.
  const rawCapture = (req: Request, _res: Response, next: NextFunction) => {
    // Someone else already drained the stream — a global `express.json()` or
    // `express.urlencoded()` mounted ahead of this router is the usual cause.
    // Without this branch, `req.on("end")` never fires for a stream that already
    // ended, `next()` is never called, and the request HANGS with no response:
    // the provider times out and retries, and nothing is logged. Failing loudly
    // and continuing is strictly better — verification then refuses the empty
    // body with a 401, a visible symptom that points at the real cause.
    if (req.readableEnded || req.complete) {
      process.stderr.write(
        "[gateway-sms] raw body already consumed before signature capture — mount this router " +
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
  };

  const handler = (req: Request, res: Response): void => {
    const ctx = buildSignatureContext(req, opts.adapter.publicUrl);
    if (!opts.adapter.verifySignature(ctx)) {
      res.status(401).type("text/plain").send("invalid signature");
      return;
    }
    let event: ReturnType<typeof opts.adapter.buildEventFromCtx>;
    try {
      event = opts.adapter.buildEventFromCtx(ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).type("text/plain").send(`parse failed: ${msg}`);
      return;
    }
    // Same contract as the LINE server: the provider is answered before the handler runs, so a
    // slow handler cannot become a provider retry. That makes the dispatch floated, and a floated
    // rejection ends the process — so it is caught here rather than left to the runtime (#41).
    void opts.adapter.dispatchEvent(event).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[gateway-sms] webhook dispatch failed: ${message}\n`);
    });
    // Twilio expects either TwiML or 204; 204 keeps things simple
    // and avoids accidentally double-replying.
    res.status(204).end();
  };

  app.post(`${prefix}/${backend}`, rawCapture, handler);

  let server: import("node:http").Server | undefined;
  let started = false;
  let stopped = false;

  return {
    async start(): Promise<void> {
      if (started || opts.app !== undefined) {
        // When caller injected its own app, we don't manage the listener.
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
