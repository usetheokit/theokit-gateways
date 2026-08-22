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
      (this.listeners[event] ??= []).push(listener as never);
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
    // The cross-adapter invariant in packages/gateway reads this package's whole src tree, so
    // a new backend that discarded a rejection would trip it. It is also the defect that
    // ended the process in two adapters (#41).
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
    let release: (() => void) | undefined;
    socket.gate = () =>
      new Promise<void>((resolve) => {
        release = resolve;
        setTimeout(resolve, 5);
      });

    const all = Promise.all([
      backend.send({ to: "1", isGroup: false, text: "a" }),
      backend.send({ to: "2", isGroup: false, text: "b" }),
      backend.send({ to: "3", isGroup: false, text: "c" }),
    ]);
    release?.();
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
