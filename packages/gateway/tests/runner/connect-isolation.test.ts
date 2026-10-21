/**
 * `connectFailure: "isolate"` on `GatewayRunner` (FR-003; alignment AC-002).
 *
 * Under isolate, one adapter that cannot connect no longer takes the others down: `start()`
 * resolves with what connected and what failed, and only the connected adapters receive inbound
 * dispatch. The default, `"rollback"`, keeps the all-or-nothing start pinned by
 * `gateway-runner.test.ts`, which this file does not touch.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { type GatewayHandler, GatewayRunner } from "../../src/runner/gateway-runner.js";
import type { MessageEvent } from "../../src/types/message-event.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

// Assembled at runtime, built to Telegram's documented `<bot_id>:<secret>` format, as in
// redaction-wiring.test.ts.
const SYNTHETIC_TOKEN = ["8123456789", "AAF-zZbQm3kL9xTuVw1yRs4pQd7NhGjKlMn"].join(":");
const SECRET_HALF = SYNTHETIC_TOKEN.split(":")[1] ?? "";

class ThrowingAdapter extends MockAdapter {
  constructor(
    platform: MockAdapter["platform"],
    private readonly message: string,
  ) {
    super(platform);
  }

  override async connect(): Promise<boolean> {
    this.connectCount += 1;
    throw new Error(this.message);
  }
}

/** A `connect` that throws before it returns a promise, as a non-async implementation can. */
class SyncThrowingAdapter extends MockAdapter {
  override connect(): Promise<boolean> {
    this.connectCount += 1;
    throw new Error("sync connect failure");
  }
}

class DeferredAdapter extends MockAdapter {
  private release: ((ok: boolean) => void) | undefined;

  override connect(): Promise<boolean> {
    this.connectCount += 1;
    return new Promise<boolean>((resolve) => {
      this.release = resolve;
    });
  }

  settle(ok: boolean): void {
    this.release?.(ok);
  }
}

function eventFor(platform: "telegram" | "discord"): MessageEvent {
  if (platform === "telegram") {
    return {
      id: "tg-1",
      platform: "telegram",
      sender: { id: "100" },
      channel: { id: "1", type: "dm" },
      text: "hi",
      receivedAt: 0,
      telegram: { chatId: 1, messageId: 1, raw: {} },
    };
  }
  return {
    id: "dc-1",
    platform: "discord",
    sender: { id: "uA" },
    channel: { id: "c1", type: "group" },
    text: "hi",
    receivedAt: 0,
    discord: { guildId: "g1", channelId: "c1", messageId: "m1", raw: {} },
  };
}

async function waitFor(condition: () => boolean, what: string, deadlineMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > deadlineMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const runners: GatewayRunner[] = [];

function isolated(
  adapters: MockAdapter[],
  handler: GatewayHandler = vi.fn(async () => {}),
): GatewayRunner {
  const runner = new GatewayRunner({ adapters, handler, connectFailure: "isolate" });
  runners.push(runner);
  return runner;
}

afterEach(async () => {
  await Promise.all(runners.splice(0).map((r) => r.stop()));
});

describe("GatewayRunner connectFailure", () => {
  it("isolate starts the adapters that connect and reports the one that refused", async () => {
    const ok = new MockAdapter("telegram");
    const refuses = new MockAdapter("discord");
    refuses.connectResult = false;

    const result = await isolated([ok, refuses]).start();

    expect(result).toEqual({
      connected: ["telegram"],
      failed: [{ platform: "discord", reason: "connect returned false" }],
    });
    expect(ok.connected).toBe(true);
  });

  it("isolate wires inbound only for connected adapters", async () => {
    const ok = new MockAdapter("telegram");
    const refuses = new MockAdapter("discord");
    refuses.connectResult = false;
    const handler = vi.fn(async (_event: MessageEvent) => {});

    await isolated([ok, refuses], handler).start();
    await refuses.emit(eventFor("discord"));
    await ok.emit(eventFor("telegram"));

    await waitFor(() => handler.mock.calls.length > 0, "the connected adapter's handler call");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ platform: "telegram" });
  });

  it("isolate reports an adapter whose connect throws", async () => {
    const ok = new MockAdapter("telegram");
    const throws = new ThrowingAdapter("discord", "socket hang up");

    const result = await isolated([ok, throws]).start();

    expect(result).toEqual({
      connected: ["telegram"],
      failed: [{ platform: "discord", reason: "socket hang up" }],
    });
  });

  it("isolate reports an adapter whose connect throws synchronously", async () => {
    const ok = new MockAdapter("telegram");
    const throws = new SyncThrowingAdapter("discord");

    const result = await isolated([throws, ok]).start();

    expect(result).toEqual({
      connected: ["telegram"],
      failed: [{ platform: "discord", reason: "sync connect failure" }],
    });
    expect(ok.connectCount).toBe(1);
  });

  it("rollback resolves with every adapter connected and none failed", async () => {
    const a = new MockAdapter("telegram");
    const b = new MockAdapter("discord");
    const runner = new GatewayRunner({ adapters: [a, b], handler: async () => {} });
    runners.push(runner);

    expect(await runner.start()).toEqual({ connected: ["telegram", "discord"], failed: [] });
  });

  it("isolate resolves with no adapter connected when all refuse", async () => {
    const a = new MockAdapter("telegram");
    const b = new MockAdapter("discord");
    a.connectResult = false;
    b.connectResult = false;

    const result = await isolated([a, b]).start();

    expect(result.connected).toEqual([]);
    expect(result.failed.map((f) => f.platform)).toEqual(["telegram", "discord"]);
  });

  it("isolate redacts a secret in a thrown connect reason", async () => {
    const throws = new ThrowingAdapter("telegram", `getMe failed for token=${SYNTHETIC_TOKEN}`);

    const result = await isolated([throws]).start();

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.reason).toContain("getMe failed");
    expect(result.failed[0]?.reason).not.toContain(SECRET_HALF);
  });

  it("isolate returns the first result to a second sequential start", async () => {
    const a = new MockAdapter("telegram");
    const runner = isolated([a]);

    const first = await runner.start();
    const second = await runner.start();

    expect(second).toBe(first);
    expect(a.connectCount).toBe(1);
  });

  it("stop disconnects an adapter that refused to connect without failing", async () => {
    const ok = new MockAdapter("telegram");
    const refuses = new MockAdapter("discord");
    refuses.connectResult = false;
    const runner = isolated([ok, refuses]);

    await runner.start();
    await runner.stop();

    expect(refuses.disconnectCount).toBe(1);
    expect(ok.disconnectCount).toBe(1);
  });

  it("isolate with zero adapters resolves empty", async () => {
    expect(await isolated([]).start()).toEqual({ connected: [], failed: [] });
  });

  it("isolate waits for every connect to settle, whatever order they settle in", async () => {
    const first = new DeferredAdapter("telegram");
    const second = new DeferredAdapter("discord");
    let settled = false;

    const started = isolated([first, second])
      .start()
      .then((result) => {
        settled = true;
        return result;
      });
    second.settle(true);
    // A macrotask runs only once every queued microtask has: a start() that resolved on the first
    // settled connect would have resolved by now, however many promise hops its chain takes.
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled, "start() resolved before every connect settled").toBe(false);
    first.settle(true);

    expect(await started).toEqual({ connected: ["telegram", "discord"], failed: [] });
  });
});
