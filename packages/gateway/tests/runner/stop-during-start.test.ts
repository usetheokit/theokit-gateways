/**
 * A stop() that lands while start() is still connecting must leave nothing live behind.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { GatewayRunner } from "../../src/runner/gateway-runner.js";
import type { MessageEvent } from "../../src/types/message-event.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

/** A MockAdapter whose connect() stays pending until the test releases it. */
class HeldConnectAdapter extends MockAdapter {
  private releases: Array<() => void> = [];

  override async connect(): Promise<boolean> {
    this.connectCount += 1;
    await new Promise<void>((resolve) => this.releases.push(resolve));
    this.connected = this.connectResult;
    return this.connectResult;
  }

  get pendingConnects(): number {
    return this.releases.length;
  }

  release(): void {
    for (const r of this.releases.splice(0)) r();
  }
}

/** A HeldConnectAdapter whose disconnect() always rejects. */
class DisconnectRejectingHeldAdapter extends HeldConnectAdapter {
  override async disconnect(): Promise<void> {
    this.disconnectCount += 1;
    throw new Error("socket close failed");
  }
}

/** A MockAdapter whose disconnect() always rejects. */
class DisconnectRejectingAdapter extends MockAdapter {
  override async disconnect(): Promise<void> {
    this.disconnectCount += 1;
    throw new Error("socket close failed");
  }
}

/** Capture what the runner writes to stderr, without printing it. */
function captureStderr(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`never happened: ${what}`);
    await new Promise((r) => setTimeout(r, 1));
  }
}

const inboundEvent: MessageEvent = {
  id: "tg-1-2",
  platform: "telegram",
  sender: { id: "100" },
  channel: { id: "1", type: "dm" },
  text: "hi",
  receivedAt: 0,
  telegram: { chatId: 1, messageId: 1, raw: {} },
};

async function stateAfterStopDuringStart(connectFailure: "rollback" | "isolate") {
  const a = new HeldConnectAdapter("telegram");
  let handled = 0;
  const runner = new GatewayRunner({
    adapters: [a],
    handler: async () => {
      handled += 1;
    },
    connectFailure,
  });

  let startSettled = false;
  const started = runner.start().finally(() => {
    startSettled = true;
  });
  await waitFor(() => a.pendingConnects > 0, "the connect() to be entered");
  await runner.stop();
  // stop() returned while the connect is still held: the window this test is about.
  expect(startSettled, "start() settled before stop() ran").toBe(false);
  a.release();
  await started.catch(() => undefined);
  await a.emit(inboundEvent);
  // The runner hands an event off without awaiting it; read the count once that work drained.
  await waitFor(() => runner._inflightSize === 0, "the dispatched event to drain");
  return { connected: a.connected, handled };
}

describe("GatewayRunner.stop() called while start() is still connecting", () => {
  it("leaves_no_adapter_connected_under_the_default_rollback_mode", async () => {
    const after = await stateAfterStopDuringStart("rollback");
    expect(after.connected, "the adapter is still connected on a stopped runner").toBe(false);
  });

  it("leaves_no_adapter_connected_under_the_isolate_mode", async () => {
    const after = await stateAfterStopDuringStart("isolate");
    expect(after.connected, "the adapter is still connected on a stopped runner").toBe(false);
  });

  it("dispatches_no_inbound_event_after_stop_under_the_default_rollback_mode", async () => {
    const after = await stateAfterStopDuringStart("rollback");
    expect(after.handled, "an event reached the handler of a stopped runner").toBe(0);
  });

  it("dispatches_no_inbound_event_after_stop_under_the_isolate_mode", async () => {
    const after = await stateAfterStopDuringStart("isolate");
    expect(after.handled, "an event reached the handler of a stopped runner").toBe(0);
  });

  it("resolves_with_no_adapter_connected_when_stop_overtakes_it", async () => {
    const a = new HeldConnectAdapter("telegram");
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });

    const started = runner.start();
    await waitFor(() => a.pendingConnects > 0, "the connect() to be entered");
    await runner.stop();
    a.release();
    const result = await started;

    expect(result).toEqual({ connected: [], failed: [] });
    expect(a.connected).toBe(false);
  });

  it("resolves_both_overlapping_calls_with_no_adapter_connected_when_stop_overtakes_them", async () => {
    const a = new HeldConnectAdapter("telegram");
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });

    const first = runner.start();
    const second = runner.start();
    await waitFor(() => a.pendingConnects > 0, "the connect() to be entered");
    await runner.stop();
    a.release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult, "the overlapping calls resolved different results").toBe(secondResult);
    expect(firstResult).toEqual({ connected: [], failed: [] });
    expect(a.connectCount).toBe(1);
    expect(a.connected).toBe(false);
  });

  it("rejects_with_the_connect_failure_when_stop_overtakes_a_failing_rollback", async () => {
    const a = new HeldConnectAdapter("telegram");
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });

    // The catch sits on the start() call, so the rejection is never unhandled.
    const started = runner.start().catch((err: unknown) => err);
    await waitFor(() => a.pendingConnects > 0, "the connect() to be entered");
    await runner.stop();
    a.connectResult = false;
    a.release();
    const error = await started;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("connect returned false");
    expect(a.connected).toBe(false);
  });

  it("reports_a_disconnect_that_fails_while_releasing_an_overtaken_start", async () => {
    const stderr = captureStderr();
    const a = new DisconnectRejectingHeldAdapter("telegram");
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });

    const started = runner.start();
    await waitFor(() => a.pendingConnects > 0, "the connect() to be entered");
    await runner.stop();
    a.release();
    const result = await started;

    expect(result, "a failed disconnect turned the overtaken start into a rejection").toEqual({
      connected: [],
      failed: [],
    });
    const report = stderr.filter((line) => line.includes("disconnect failed"));
    expect(report, "the failed disconnect left no trace").toHaveLength(1);
    expect(report[0]).toContain('"telegram"');
    expect(report[0]).toContain("socket close failed");
  });

  it("keeps_the_failed_list_when_stop_overtakes_an_isolate_start", async () => {
    const telegram = new HeldConnectAdapter("telegram");
    const discord = new MockAdapter("discord");
    discord.connectResult = false;
    const runner = new GatewayRunner({
      adapters: [telegram, discord],
      handler: async () => {},
      connectFailure: "isolate",
    });

    const started = runner.start();
    await waitFor(() => telegram.pendingConnects > 0, "the telegram connect() to be entered");
    await runner.stop();
    telegram.release();
    const result = await started;

    expect(result).toEqual({
      connected: [],
      failed: [{ platform: "discord", reason: "connect returned false" }],
    });
    expect(telegram.connected).toBe(false);
  });
});

/** A `connect` that throws before it returns a promise, as a non-async implementation can. */
class SyncThrowingAdapter extends MockAdapter {
  override connect(): Promise<boolean> {
    this.connectCount += 1;
    throw new Error("sync connect failure");
  }
}

/** A `connect` that rejects with no reason at all. */
class UndefinedRejectingAdapter extends MockAdapter {
  override connect(): Promise<boolean> {
    this.connectCount += 1;
    return Promise.reject(undefined);
  }
}

describe("GatewayRunner.start() under rollback when one adapter fails", () => {
  it("leaves_no_adapter_connected_when_one_connects_after_the_rollback_rejected", async () => {
    const telegram = new HeldConnectAdapter("telegram");
    const discord = new HeldConnectAdapter("discord");
    const runner = new GatewayRunner({ adapters: [telegram, discord], handler: async () => {} });

    // The catch sits on the start() call, so the rejection is never unhandled.
    const started = runner.start().catch((err: unknown) => err);
    await waitFor(
      () => telegram.pendingConnects > 0 && discord.pendingConnects > 0,
      "both connects to be entered",
    );
    await runner.stop();
    discord.connectResult = false;
    discord.release();
    // One macrotask is an event-loop barrier: every pending microtask runs first, so a rollback
    // that does not wait for the other connect has already rejected by now. Nothing asserts on time.
    await new Promise((r) => setTimeout(r, 0));
    telegram.connectResult = true;
    telegram.release();
    const error = await started;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("discord");
    expect(telegram.connected, "telegram connected after the rollback and stayed live").toBe(false);
  });

  it("leaves_no_adapter_connected_when_one_connects_after_a_rollback_failure_without_stop", async () => {
    const telegram = new HeldConnectAdapter("telegram");
    const discord = new HeldConnectAdapter("discord");
    const runner = new GatewayRunner({ adapters: [telegram, discord], handler: async () => {} });

    // The catch sits on the start() call, so the rejection is never unhandled.
    const started = runner.start().catch((err: unknown) => err);
    await waitFor(
      () => telegram.pendingConnects > 0 && discord.pendingConnects > 0,
      "both connects to be entered",
    );
    discord.connectResult = false;
    discord.release();
    // One macrotask is an event-loop barrier: every pending microtask runs first, so a rollback
    // that does not wait for the other connect has already rejected by now. Nothing asserts on time.
    await new Promise((r) => setTimeout(r, 0));
    telegram.release();
    const error = await started;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("discord");
    expect(telegram.connected, "telegram connected after the rollback and stayed live").toBe(false);
  });

  it("reports_a_disconnect_that_fails_during_the_rollback", async () => {
    const stderr = captureStderr();
    const telegram = new DisconnectRejectingAdapter("telegram");
    const discord = new MockAdapter("discord");
    discord.connectResult = false;
    const runner = new GatewayRunner({ adapters: [telegram, discord], handler: async () => {} });

    await expect(runner.start()).rejects.toThrow('adapter "discord" connect returned false');
    const report = stderr.filter((line) => line.includes("disconnect failed"));
    expect(report, "the failed disconnect left no trace").toHaveLength(1);
    expect(report[0]).toContain('"telegram"');
    expect(report[0]).toContain("socket close failed");
  });

  it("rolls_back_when_a_connect_throws_synchronously", async () => {
    const telegram = new MockAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [telegram, new SyncThrowingAdapter("discord")],
      handler: async () => {},
    });

    await expect(runner.start()).rejects.toThrow("sync connect failure");
    expect(telegram.connected, "the adapter that did connect was left open").toBe(false);
  });

  it("rolls_back_when_a_connect_rejects_with_undefined", async () => {
    const telegram = new MockAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [telegram, new UndefinedRejectingAdapter("discord")],
      handler: async () => {},
    });

    const outcome = await runner.start().then(
      () => "resolved",
      (reason: unknown) => ({ rejectedWith: reason }),
    );
    expect(outcome).toHaveProperty("rejectedWith", undefined);
    expect(telegram.connected, "the adapter that did connect was left open").toBe(false);
  });
});
