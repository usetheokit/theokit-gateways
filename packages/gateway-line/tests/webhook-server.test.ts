/**
 * `createWebhookServer` — the inbound HTTP surface, and the half of LINE's auth
 * boundary that had no test.
 *
 * `signature.test.ts` covers the pure verifier well. It never covered the server
 * that CALLS it, and the server is where the security property lives:
 * verification protects nothing unless it runs before dispatch and
 * short-circuits the request. Reorder `handlerFactory` so
 * `dispatchWebhookBody` runs before the 401 check and unauthenticated payloads
 * reach the agent with the whole suite green.
 *
 * The tests drive a real Express app over a real loopback socket, because the
 * most damaging failure here — a request body already consumed by an earlier
 * middleware — cannot be reproduced with a fake request object.
 */

import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import express, { type Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LineAdapter } from "../src/adapter.js";
import { createWebhookServer } from "../src/webhook-server.js";

const CHANNEL_SECRET = "line-channel-secret-1";

function sign(body: string, secret = CHANNEL_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

interface Recorder {
  dispatched: unknown[];
  order: string[];
}

function makeAdapter(secret = CHANNEL_SECRET) {
  const rec: Recorder = { dispatched: [], order: [] };
  const adapter = {
    getChannelSecret: () => secret,
    async dispatchWebhookBody(envelope: unknown) {
      rec.dispatched.push(envelope);
      rec.order.push("dispatch");
    },
  } as unknown as LineAdapter;
  return { adapter, rec };
}

const servers: Server[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  vi.restoreAllMocks();
});

async function listen(app: Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function post(
  base: string,
  path: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  return { status: res.status, text: await res.text() };
}

const ENVELOPE = JSON.stringify({
  destination: "U-dest",
  events: [
    {
      type: "message",
      replyToken: "rt-1",
      source: { type: "user", userId: "U-1" },
      message: { type: "text", id: "m1", text: "hi" },
      timestamp: 1_700_000_000_000,
    },
  ],
});

/** A port nothing is listening on, so the restart test can probe a known address. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

describe("createWebhookServer — auth boundary", () => {
  it("rejects an unsigned request with 401 and never dispatches", async () => {
    const app = express();
    const { adapter, rec } = makeAdapter();
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const res = await post(base, "/line", ENVELOPE);

    expect(res.status).toBe(401);
    // The status alone is not the property. Nothing downstream may have run.
    expect(rec.dispatched).toEqual([]);
    expect(rec.order).toEqual([]);
  });

  it("rejects a request signed with the wrong secret", async () => {
    const app = express();
    const { adapter, rec } = makeAdapter();
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const res = await post(base, "/line", ENVELOPE, {
      "x-line-signature": sign(ENVELOPE, "attacker-secret"),
    });

    expect(res.status).toBe(401);
    expect(rec.dispatched).toEqual([]);
  });

  it("rejects a valid signature computed over a DIFFERENT body", async () => {
    // The replay that a body-agnostic check would let through: a signature the
    // attacker captured from an earlier legitimate request, reused on new content.
    const app = express();
    const { adapter, rec } = makeAdapter();
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const res = await post(base, "/line", ENVELOPE, {
      "x-line-signature": sign(JSON.stringify({ events: [] })),
    });

    expect(res.status).toBe(401);
    expect(rec.dispatched).toEqual([]);
  });

  it("accepts and dispatches a correctly signed envelope", async () => {
    const app = express();
    const { adapter, rec } = makeAdapter();
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const res = await post(base, "/line", ENVELOPE, { "x-line-signature": sign(ENVELOPE) });

    expect(res.status).toBe(200);
    expect(rec.dispatched).toHaveLength(1);
  });
});

describe("createWebhookServer — malformed payloads", () => {
  it("answers 400 for a signed body that is not JSON", async () => {
    const app = express();
    const { adapter, rec } = makeAdapter();
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const body = "{not json";
    const res = await post(base, "/line", body, { "x-line-signature": sign(body) });

    // 400 and not 500: LINE retries 5xx, so a permanently broken payload would
    // come back forever.
    expect(res.status).toBe(400);
    expect(rec.dispatched).toEqual([]);
  });

  it("answers 400 for a signed JSON body with no events array", async () => {
    const app = express();
    const { adapter, rec } = makeAdapter();
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const body = JSON.stringify({ destination: "U-dest" });
    const res = await post(base, "/line", body, { "x-line-signature": sign(body) });

    expect(res.status).toBe(400);
    expect(rec.dispatched).toEqual([]);
  });

  it("accepts LINE's empty-events verification ping", async () => {
    // LINE posts `{"events":[]}` when you press Verify in the console. Rejecting
    // it makes the console report the webhook as broken while it works.
    const app = express();
    const { adapter } = makeAdapter();
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const body = JSON.stringify({ destination: "U-dest", events: [] });
    const res = await post(base, "/line", body, { "x-line-signature": sign(body) });

    expect(res.status).toBe(200);
  });
});

describe("createWebhookServer — raw body capture", () => {
  it("hashes the exact bytes received, not a re-serialized copy", async () => {
    // The signature is over the raw bytes. This body round-trips through
    // JSON.parse/stringify to something byte-different, so it only verifies if
    // the original bytes were preserved.
    const app = express();
    const { adapter, rec } = makeAdapter();
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const spaced = '{"destination":"U-dest",  "events": [] }';
    const res = await post(base, "/line", spaced, { "x-line-signature": sign(spaced) });

    expect(res.status).toBe(200);
    expect(rec.dispatched).toHaveLength(1);
  });

  it("answers instead of hanging when a global body parser drained the stream first", async () => {
    // `rawCapture` waits on `req.on("end")`, which never fires for a stream that
    // has already ended — so `next()` was never called and the request hung with
    // no response at all. The provider times out and retries; nothing is logged.
    // It now detects the consumed stream, says so on stderr, and continues with
    // an empty body, which verification refuses with a visible 401.
    const app = express();
    app.use(express.json());
    const { adapter, rec } = makeAdapter();
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await createWebhookServer({ adapter, app });
    const base = await listen(app);

    const res = await post(base, "/line", ENVELOPE, { "x-line-signature": sign(ENVELOPE) });

    expect(res.status).toBe(401);
    expect(rec.dispatched).toEqual([]);
    expect(String(stderr.mock.calls[0]?.[0])).toContain("already consumed");
  });
});

describe("createWebhookServer — mounting", () => {
  it("honours a custom path", async () => {
    const app = express();
    const { adapter } = makeAdapter();
    await createWebhookServer({ adapter, app, path: "/hooks/line" });
    const base = await listen(app);

    expect(
      (await post(base, "/hooks/line", ENVELOPE, { "x-line-signature": sign(ENVELOPE) })).status,
    ).toBe(200);
    expect(
      (await post(base, "/line", ENVELOPE, { "x-line-signature": sign(ENVELOPE) })).status,
    ).toBe(404);
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
      const res = await post(`http://127.0.0.1:${port}`, "/line", ENVELOPE, {
        "x-line-signature": sign(ENVELOPE),
      });
      expect(res.status, "the endpoint stopped answering after a restart").toBe(200);
    } finally {
      await server.stop();
    }
  });
});
