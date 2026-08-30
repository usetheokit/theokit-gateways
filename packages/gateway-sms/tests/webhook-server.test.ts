/**
 * `createWebhookServer` — the inbound HTTP surface, and the second half of the
 * SMS auth boundary.
 *
 * No test imported this file before 2026-08-17. `signature.test.ts`-style tests
 * cover the pure verifier well, but never the server that CALLS it, and the
 * server is where the security property actually lives: verification only
 * protects anything if it runs before dispatch and short-circuits the request.
 *
 * Two inversions were invisible while this file had no importer:
 *
 * - Reorder `handler` so `dispatchEvent` runs before the 401 check, and
 *   unauthenticated payloads reach the agent with the whole suite green.
 * - `rawCapture` assumes it owns the body stream. Mount the router behind a
 *   global `express.json()` and the stream is already consumed: `rawBody` is
 *   `""`, every HMAC fails, and every legitimate webhook 401s — a total outage
 *   with no failing test.
 *
 * Both are asserted below, against a real Express app driven over a real
 * loopback socket, because a fake request object cannot reproduce a consumed
 * stream — which is the failure mode that matters.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import express, { type Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SMSAdapter } from "../src/adapter.js";
import type { SignatureContext } from "../src/backend-types.js";
import { createWebhookServer } from "../src/webhook-server.js";

interface Recorder {
  verifyCalls: SignatureContext[];
  buildCalls: SignatureContext[];
  dispatched: unknown[];
  /** Order of operations, so "verified before dispatch" is checkable. */
  order: string[];
}

function makeAdapter(opts: { verify?: boolean; buildThrows?: boolean } = {}) {
  const rec: Recorder = { verifyCalls: [], buildCalls: [], dispatched: [], order: [] };
  const adapter = {
    getBackendKind: () => "twilio" as const,
    verifySignature(ctx: SignatureContext) {
      rec.verifyCalls.push(ctx);
      rec.order.push("verify");
      return opts.verify ?? true;
    },
    buildEventFromCtx(ctx: SignatureContext) {
      rec.buildCalls.push(ctx);
      rec.order.push("build");
      if (opts.buildThrows === true) throw new Error("phone number is empty");
      return { id: "evt-1", platform: "sms", text: "hi" };
    },
    async dispatchEvent(event: unknown) {
      rec.dispatched.push(event);
      rec.order.push("dispatch");
      return "ok" as const;
    },
  } as unknown as SMSAdapter;
  return { adapter, rec };
}

const servers: Server[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  vi.restoreAllMocks();
});

/** Boot `app` on an ephemeral port and return its base URL. */
async function listen(app: Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

const FORM_BODY = "From=%2B5511999999999&To=%2B5511888888888&Body=hi&MessageSid=SM1";

async function post(
  base: string,
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
  return { status: res.status, text: await res.text() };
}

/** A port nothing is listening on, so the restart test can probe a known address. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

describe("createWebhookServer — auth boundary", () => {
  it("rejects an unverified request with 401 and never dispatches", async () => {
    const app = express();
    const { adapter, rec } = makeAdapter({ verify: false });
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const res = await post(base, "/sms/twilio", FORM_BODY);

    expect(res.status).toBe(401);
    // The property that matters is not the status code — it is that nothing
    // downstream ran. A 401 returned AFTER dispatch would still read as 401 here.
    expect(rec.dispatched).toEqual([]);
    expect(rec.buildCalls).toEqual([]);
    expect(rec.order).toEqual(["verify"]);
  });

  it("verifies BEFORE it builds or dispatches on the happy path", async () => {
    const app = express();
    const { adapter, rec } = makeAdapter({ verify: true });
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const res = await post(base, "/sms/twilio", FORM_BODY);

    expect(res.status).toBe(204);
    expect(rec.order).toEqual(["verify", "build", "dispatch"]);
    expect(rec.dispatched).toHaveLength(1);
  });

  it("answers 400, not 500, when the body cannot be parsed", async () => {
    // Providers retry 5xx. Returning 500 for a permanently malformed payload
    // turns one bad request into a retry storm; 400 tells the provider to stop.
    const app = express();
    const { adapter, rec } = makeAdapter({ verify: true, buildThrows: true });
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const res = await post(base, "/sms/twilio", "garbage");

    expect(res.status).toBe(400);
    expect(rec.dispatched).toEqual([]);
  });
});

describe("createWebhookServer — raw body capture", () => {
  it("hands the verifier the exact bytes received", async () => {
    // Signature verification is over the raw bytes. Any re-encoding — a parsed
    // and re-serialized body, a normalized ampersand — invalidates the HMAC.
    const app = express();
    const { adapter, rec } = makeAdapter({ verify: true });
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    await post(base, "/sms/twilio", FORM_BODY);

    expect(rec.verifyCalls[0]?.rawBody).toBe(FORM_BODY);
  });

  it("reconstructs the URL the provider posted to, honouring x-forwarded-proto", async () => {
    // Twilio's HMAC covers the full URL. Behind a TLS-terminating proxy the
    // request arrives as http, so the signature is computed over an https URL
    // that this code has to rebuild — get it wrong and every request 401s.
    const app = express();
    const { adapter, rec } = makeAdapter({ verify: true });
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    await post(base, "/sms/twilio", FORM_BODY, { "x-forwarded-proto": "https" });

    expect(rec.verifyCalls[0]?.url).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/sms\/twilio$/);
  });

  it("lowercases header names for the verifier", async () => {
    const app = express();
    const { adapter, rec } = makeAdapter({ verify: true });
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    await post(base, "/sms/twilio", FORM_BODY, { "X-Twilio-Signature": "sig-abc" });

    expect(rec.verifyCalls[0]?.headers["x-twilio-signature"]).toBe("sig-abc");
  });

  it("answers instead of hanging when a global body parser drained the stream first", async () => {
    // Writing this test found a worse bug than the one it was written for.
    // `rawCapture` waits on `req.on("end")`, which never fires for a stream that
    // has ALREADY ended — so `next()` was never called and the request hung with
    // no response at all. The provider times out and retries; nothing is logged;
    // nothing in the suite noticed, because no test imported this file.
    //
    // It now detects the consumed stream, says so on stderr, and continues with
    // an empty rawBody. Verification then refuses it — a 401 is a visible
    // symptom pointing at the middleware order, where a hang points at nothing.
    const app = express();
    app.use(express.urlencoded({ extended: false })); // consumes the stream first
    const { adapter, rec } = makeAdapter({ verify: true });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const res = await post(base, "/sms/twilio", FORM_BODY);

    // The assertion that matters: a response came back at all.
    expect(res.status).toBe(204);
    expect(rec.verifyCalls[0]?.rawBody).toBe("");
    expect(stderr).toHaveBeenCalled();
    expect(String(stderr.mock.calls[0]?.[0])).toContain("already consumed");
  });
});

describe("createWebhookServer — mounting", () => {
  it("mounts under the backend kind, and only there", async () => {
    const app = express();
    const { adapter } = makeAdapter({ verify: true });
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    expect((await post(base, "/sms/twilio", FORM_BODY)).status).toBe(204);
    // A route that answered for every backend would accept a Plivo-signed
    // payload on the Twilio verifier.
    expect((await post(base, "/sms/plivo", FORM_BODY)).status).toBe(404);
  });

  it("honours a custom path prefix", async () => {
    const app = express();
    const { adapter } = makeAdapter({ verify: true });
    await createWebhookServer({ adapter, app, path: "/hooks" });
    const base = await listen(app);

    expect((await post(base, "/hooks/twilio", FORM_BODY)).status).toBe(204);
    expect((await post(base, "/sms/twilio", FORM_BODY)).status).toBe(404);
  });

  it("serves again after a stop — start() is not a one-way door", async () => {
    // `started` and `stopped` are latched and never reset, so a `start()` after a `stop()` returns
    // without creating a listener and the server is silently dead. The idempotence test above cannot
    // catch it: it does start-start-stop-stop and never start-stop-start.
    //
    // Asserted on the OWNED-listener path, because that is where a listener exists to lose — and
    // observed from outside, by whether the endpoint answers, since the interface exposes no handle.
    const port = await freePort();
    const { adapter } = makeAdapter();
    const server = await createWebhookServer({ adapter, port });

    await server.start();
    await server.stop();
    await server.start();

    try {
      const res = await post(`http://127.0.0.1:${port}`, "/sms/twilio", FORM_BODY);
      expect(res.status, "the endpoint stopped answering after a restart").toBe(204);
    } finally {
      await server.stop();
    }
  });
});
