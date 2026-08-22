/**
 * `WhatsAppBaileysBackend` — lifecycle, inbound dispatch and outbound.
 *
 * Every test drives an injected fake socket. `baileys` is an OPTIONAL peer dependency and CI
 * does not install it, so a suite that needed the real library would be a suite that never
 * runs — which is exactly how the `web` backend reached production unable to start (B-002).
 *
 * What this suite does NOT prove: that any of it speaks WhatsApp. Pairing needs a QR scan by
 * a human and there is no WhatsApp in Docker, so protocol conformance, delivery and ban
 * behaviour are unproven here and by every gate in this repository.
 */

import { describe, expect, it, vi } from "vitest";
import { WhatsAppBaileysBackend } from "../src/backend/baileys/index.js";
import type {
  BaileysConnectionUpdate,
  BaileysEventMap,
  BaileysSocketLike,
  BaileysSocketOptions,
} from "../src/backend/baileys/socket.js";

/** A socket a test can drive, recording what the backend asked of it. */
class FakeSocket implements BaileysSocketLike {
  readonly sent: Array<{ jid: string; text: string; at: number; done?: number }> = [];
  ended = false;
  private listeners: { [K in keyof BaileysEventMap]?: Array<(p: BaileysEventMap[K]) => void> } = {};
  /** Resolve a send by hand; when unset, sends resolve immediately. */
  gate?: () => Promise<void>;
  sendError?: Error;

  readonly ev = {
    on: <K extends keyof BaileysEventMap>(
      event: K,
      listener: (payload: BaileysEventMap[K]) => void,
    ): void => {
      const existing = this.listeners[event] ?? [];
      existing.push(listener as never);
      this.listeners[event] = existing;
    },
  };

  async sendMessage(
    jid: string,
    content: { text: string },
  ): Promise<{ key?: { id?: string } } | undefined> {
    const record: { jid: string; text: string; at: number; done?: number } = {
      jid,
      text: content.text,
      at: Date.now(),
    };
    this.sent.push(record);
    if (this.sendError !== undefined) throw this.sendError;
    if (this.gate !== undefined) await this.gate();
    record.done = Date.now();
    return { key: { id: `wamid.${this.sent.length}` } };
  }

  end(): void {
    this.ended = true;
  }

  /** Test helper: emit an event the way Baileys would. */
  emit<K extends keyof BaileysEventMap>(event: K, payload: BaileysEventMap[K]): void {
    for (const listener of this.listeners[event] ?? []) listener(payload as never);
  }

  open(): void {
    this.emit("connection.update", { connection: "open" } satisfies BaileysConnectionUpdate);
  }
}

function makeBackend(overrides: Record<string, unknown> = {}) {
  const socket = new FakeSocket();
  let created = 0;
  const backend = new WhatsAppBaileysBackend({
    sessionDir: "/tmp/does-not-matter",
    connectTimeoutMs: 500,
    sendTimeoutMs: 500,
    socketFactory: async () => {
      created += 1;
      return socket;
    },
    ...overrides,
  });
  return { backend, socket, created: () => created };
}

/** An inbound envelope the normaliser accepts. */
function inbound(text: string, id = "M1"): unknown {
  return {
    key: { remoteJid: "5511999999999@s.whatsapp.net", fromMe: false, id },
    messageTimestamp: 1_700_000_000,
    pushName: "Ana",
    message: { conversation: text },
  };
}

describe("WhatsAppBaileysBackend — lifecycle", () => {
  it("declares itself as the third backend kind", () => {
    expect(makeBackend().backend.kind).toBe("baileys");
  });

  it("resolves connect when the socket reports open", async () => {
    const { backend, socket } = makeBackend();
    const connecting = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    socket.open();

    expect(await connecting).toBe(true);
    await backend.disconnect();
  });

  it("returns false rather than hanging when the socket never opens", async () => {
    // Failure scenario from the plan: the socket that never reports open. A hang here would
    // be worse than a failure — the caller has nothing to time out against.
    const { backend } = makeBackend({ connectTimeoutMs: 120 });

    expect(await backend.connect()).toBe(false);
    await backend.disconnect();
  });

  it("opens one socket for two connect() calls issued at once", async () => {
    // A concurrent test, and the only kind that can observe a double-open: two callers in
    // parallel racing the same guard. WhatsApp's own adapter shipped without this guard once
    // and opened two live sessions (its test asserted connectCalls === 2 and called that
    // idempotent).
    const { backend, socket, created } = makeBackend();
    const both = Promise.all([backend.connect(), backend.connect()]);
    await new Promise((r) => setTimeout(r, 10));
    socket.open();
    await both;

    expect(created()).toBe(1);
    await backend.disconnect();
  });

  it("is idempotent on disconnect", async () => {
    const { backend, socket } = makeBackend();
    const connecting = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    socket.open();
    await connecting;

    await backend.disconnect();
    await backend.disconnect();

    expect(socket.ended).toBe(true);
  });

  it("returns to disconnected when the socket closes under it", async () => {
    const { backend, socket } = makeBackend();
    const connecting = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    socket.open();
    await connecting;

    socket.emit("connection.update", { connection: "close" });

    const result = await backend.send({ to: "5511888888888", isGroup: false, text: "hi" });
    expect(result.ok).toBe(false);
    await backend.disconnect();
  });
});

describe("WhatsAppBaileysBackend — inbound", () => {
  async function connected() {
    const { backend, socket } = makeBackend();
    const connecting = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    socket.open();
    await connecting;
    return { backend, socket };
  }

  it("dispatches a normalised event to the handler", async () => {
    const { backend, socket } = await connected();
    const seen: string[] = [];
    backend.onInbound(async (event) => void seen.push(event.text));

    socket.emit("messages.upsert", { messages: [inbound("hello")], type: "notify" });
    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toEqual(["hello"]);
    await backend.disconnect();
  });

  it("drops what the normaliser refuses, without disturbing the batch", async () => {
    const { backend, socket } = await connected();
    const seen: string[] = [];
    backend.onInbound(async (event) => void seen.push(event.text));

    socket.emit("messages.upsert", {
      messages: [
        {
          key: { remoteJid: "status@broadcast", fromMe: false, id: "S" },
          message: { conversation: "noise" },
        },
        inbound("kept", "M2"),
      ],
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toEqual(["kept"]);
    await backend.disconnect();
  });

  it("contains a handler that throws, and keeps delivering", async () => {
    // This claimed the cross-adapter invariant already covered it. Measured: the gate matched
    // `void this.…` only, so it read this backend's floated call and passed — and widening it
    // then caught two live offenders in gateway-line and gateway-sms. The gate now sees any
    // floated call; this test stays because the gate proves the shape while only this proves the
    // behaviour: that the next message still arrives after a handler throws (#41).
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { backend, socket } = await connected();
    const seen: string[] = [];
    backend.onInbound(async (event) => {
      seen.push(event.text);
      if (event.text === "boom") throw new Error("handler exploded");
    });

    socket.emit("messages.upsert", { messages: [inbound("boom", "M3")] });
    await new Promise((r) => setTimeout(r, 10));
    socket.emit("messages.upsert", { messages: [inbound("after", "M4")] });
    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toEqual(["boom", "after"]);
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toContain("handler threw");
    stderr.mockRestore();
    await backend.disconnect();
  });

  it("replaces the handler rather than stacking it (EC-H)", async () => {
    const { backend, socket } = await connected();
    const first: string[] = [];
    const second: string[] = [];
    backend.onInbound(async (e) => void first.push(e.text));
    backend.onInbound(async (e) => void second.push(e.text));

    socket.emit("messages.upsert", { messages: [inbound("once", "M5")] });
    await new Promise((r) => setTimeout(r, 10));

    expect(first).toEqual([]);
    expect(second).toEqual(["once"]);
    await backend.disconnect();
  });
});

describe("WhatsAppBaileysBackend — outbound", () => {
  async function connected(overrides: Record<string, unknown> = {}) {
    const { backend, socket } = makeBackend(overrides);
    const connecting = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    socket.open();
    await connecting;
    return { backend, socket };
  }

  it("sends to the JID the recipient implies", async () => {
    const { backend, socket } = await connected();

    const result = await backend.send({ to: "5511888888888", isGroup: false, text: "hi" });

    expect(result.ok).toBe(true);
    expect(result.wamid).toBe("wamid.1");
    expect(socket.sent[0]).toMatchObject({ jid: "5511888888888@s.whatsapp.net", text: "hi" });
    await backend.disconnect();
  });

  it("addresses a group with the group suffix", async () => {
    const { backend, socket } = await connected();

    await backend.send({ to: "120363012345678901", isGroup: true, text: "hi" });

    expect(socket.sent[0]?.jid).toBe("120363012345678901@g.us");
    await backend.disconnect();
  });

  it("runs sends one at a time, in issue order", async () => {
    // A parallel test: three sends issued at once against a socket that reports when each
    // enters and leaves. Two assertions, because a queue that serialises but reorders would
    // satisfy the first alone and still deliver out of order.
    const { backend, socket } = await connected();
    socket.gate = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

    const all = Promise.all([
      backend.send({ to: "1", isGroup: false, text: "a" }),
      backend.send({ to: "2", isGroup: false, text: "b" }),
      backend.send({ to: "3", isGroup: false, text: "c" }),
    ]);
    await all;

    expect(socket.sent.map((s) => s.text)).toEqual(["a", "b", "c"]);
    // No two intervals intersect: each send finished before the next started.
    for (let i = 1; i < socket.sent.length; i += 1) {
      const previous = socket.sent[i - 1];
      const current = socket.sent[i];
      expect(previous?.done, "a send started before its predecessor finished").toBeDefined();
      expect(current?.at ?? 0).toBeGreaterThanOrEqual(previous?.done ?? 0);
    }
    await backend.disconnect();
  });

  it("reports an unacknowledged send as undetermined, and does not retry", async () => {
    // A local timeout says the acknowledgement did not arrive, not that the message did not.
    // Retrying can duplicate — the failure this repository already shipped once, in the email
    // backend re-answering its inbox (#11).
    const { backend, socket } = await connected({ sendTimeoutMs: 60 });
    socket.gate = () => new Promise<void>(() => undefined);

    const result = await backend.send({ to: "5511888888888", isGroup: false, text: "hi" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("timeout");
    expect(result.error?.message).toMatch(/undetermined/i);
    expect(socket.sent).toHaveLength(1);
    await backend.disconnect();
  });

  it("returns a structured error when the socket rejects, never a throw", async () => {
    const { backend, socket } = await connected();
    socket.sendError = new Error("connection closed");

    const result = await backend.send({ to: "5511888888888", isGroup: false, text: "hi" });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("connection closed");
    await backend.disconnect();
  });

  it("refuses to send while disconnected", async () => {
    const { backend } = makeBackend();

    const result = await backend.send({ to: "5511888888888", isGroup: false, text: "hi" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("server_error");
  });
});

describe("WhatsAppBaileysBackend — what the review found", () => {
  it("does not start a second send while a timed-out one is still on the socket", async () => {
    // F1. The queue used to advance on the RACED result, and a timeout does not cancel
    // `sendMessage`. So a timed-out send stayed in flight while the next one started — the
    // exact concurrent-send hazard D320 exists to prevent, reached through D321.
    const socket = new FakeSocket();
    let inFlight = 0;
    let peak = 0;
    let releaseFirst: (() => void) | undefined;
    socket.gate = () =>
      new Promise<void>((resolve) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        const done = () => {
          inFlight -= 1;
          resolve();
        };
        if (releaseFirst === undefined) releaseFirst = done;
        else setTimeout(done, 5);
      });

    const backend = new WhatsAppBaileysBackend({
      sessionDir: "/tmp/x",
      connectTimeoutMs: 500,
      sendTimeoutMs: 40,
      socketFactory: async () => socket,
    });
    const connecting = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    socket.open();
    await connecting;

    const first = backend.send({ to: "1", isGroup: false, text: "a" });
    await new Promise((r) => setTimeout(r, 80)); // first has timed out, still in flight
    const second = backend.send({ to: "2", isGroup: false, text: "b" });
    await new Promise((r) => setTimeout(r, 20));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(peak, "two sends were concurrently in flight on one socket").toBe(1);
    await backend.disconnect();
  }, 30_000);

  it("tears down the socket a failed connect opened, and does not adopt a second one", async () => {
    // F2. A timed-out connect left a LIVE socket behind: it kept feeding inbound into the
    // handler, and the retry opened a second live session — which on an unofficial
    // automation is ban surface, not only a leak.
    const sockets: FakeSocket[] = [];
    const backend = new WhatsAppBaileysBackend({
      sessionDir: "/tmp/x",
      connectTimeoutMs: 60,
      socketFactory: async () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });

    expect(await backend.connect()).toBe(false);

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.ended, "the abandoned socket was left running").toBe(true);

    // And the abandoned socket must not be able to speak for the backend afterwards.
    const seen: string[] = [];
    backend.onInbound(async (event) => void seen.push(event.text));
    sockets[0]?.emit("messages.upsert", {
      messages: [inbound("from the ghost", "G")],
      type: "notify",
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(seen, "an abandoned socket delivered inbound").toEqual([]);
    await backend.disconnect();
  }, 30_000);

  it("does not wedge when disconnect arrives while connect is still opening", async () => {
    // F3. `disconnect` cleared the socket, then the in-flight open set `connected = true`
    // over a backend with no socket: every later `connect()` short-circuited on the flag and
    // every `send` was refused. Only reconstruction recovered. Same class as the Slack
    // teardown-during-connect leak fixed two commits before this backend existed.
    const socket = new FakeSocket();
    const backend = new WhatsAppBaileysBackend({
      sessionDir: "/tmp/x",
      connectTimeoutMs: 500,
      socketFactory: async () => socket,
    });

    const connecting = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    await backend.disconnect();
    socket.open(); // the abandoned attempt reports success after the teardown
    await connecting;

    const result = await backend.send({ to: "1", isGroup: false, text: "hi" });
    expect(result.ok).toBe(false);
    // The backend must be reusable: a fresh connect has to actually open something.
    const second = new FakeSocket();
    const reopened = new WhatsAppBaileysBackend({
      sessionDir: "/tmp/x",
      connectTimeoutMs: 200,
      socketFactory: async () => second,
    });
    const reconnecting = reopened.connect();
    await new Promise((r) => setTimeout(r, 10));
    second.open();
    expect(await reconnecting).toBe(true);
    await reopened.disconnect();
  }, 30_000);

  it("ignores a replayed history batch", async () => {
    // F9. `messages.upsert` carries `type: "append"` when WhatsApp replays history on
    // reconnect. Answering it is the defect #11 records in the email backend, arriving
    // through a different door.
    const socket = new FakeSocket();
    const backend = new WhatsAppBaileysBackend({
      sessionDir: "/tmp/x",
      connectTimeoutMs: 500,
      socketFactory: async () => socket,
    });
    const connecting = backend.connect();
    await new Promise((r) => setTimeout(r, 10));
    socket.open();
    await connecting;

    const seen: string[] = [];
    backend.onInbound(async (event) => void seen.push(event.text));
    socket.emit("messages.upsert", { messages: [inbound("old", "H1")], type: "append" });
    socket.emit("messages.upsert", { messages: [inbound("live", "H2")], type: "notify" });
    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toEqual(["live"]);
    await backend.disconnect();
  }, 30_000);
});

describe("WhatsAppBaileysBackend — pairing", () => {
  it("routes the QR to the caller's sink instead of stderr", async () => {
    // `onQr` exists on the socket options so a host that is not a terminal can show the code to
    // the person holding the phone. It was unreachable from the backend's config — the factory
    // was called with `sessionDir` alone — which made the option dead rather than optional.
    let received: BaileysSocketOptions | undefined;
    const sink: string[] = [];
    const backend = new WhatsAppBaileysBackend({
      sessionDir: "/tmp/x",
      connectTimeoutMs: 200,
      onQr: (qr) => void sink.push(qr),
      socketFactory: async (opts) => {
        received = opts;
        return new FakeSocket();
      },
    });
    await backend.connect();

    expect(received?.onQr).toBeDefined();
    received?.onQr?.("2@abc");
    expect(sink).toEqual(["2@abc"]);
    await backend.disconnect();
  }, 30_000);
});
