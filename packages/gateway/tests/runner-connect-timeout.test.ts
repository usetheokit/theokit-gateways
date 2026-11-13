/** `connectTimeoutMs`, `onAdapterState` and `secrets` on `GatewayRunner` under "isolate". */
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AdapterState, GatewayRunner } from "../src/runner/gateway-runner.js";
import type { PlatformName } from "../src/types/message-event.js";
import { MockAdapter } from "./adapter/mock-adapter.js";

class HangingAdapter extends MockAdapter {
  private resolveConnect: ((ok: boolean) => void) | undefined;
  inboundWired = false;
  override connect(): Promise<boolean> {
    this.connectCount += 1;
    return new Promise((r) => {
      this.resolveConnect = r;
    });
  }
  override onInbound(handler: Parameters<MockAdapter["onInbound"]>[0]): () => void {
    this.inboundWired = true;
    return super.onInbound(handler);
  }
  settle(ok: boolean): void {
    this.resolveConnect?.(ok);
  }
}

class ThrowingAdapter extends MockAdapter {
  constructor(
    platform: PlatformName,
    private readonly message: string,
  ) {
    super(platform);
  }
  override async connect(): Promise<boolean> {
    throw new Error(this.message);
  }
}

afterEach(() => vi.useRealTimers());

describe("connectTimeoutMs", () => {
  it("reports the fast adapter early and times out the slow one", async () => {
    vi.useFakeTimers();
    const fast = new MockAdapter("slack");
    const slow = new HangingAdapter("telegram");
    const states: Array<[PlatformName, AdapterState, string | undefined]> = [];
    const runner = new GatewayRunner({
      adapters: [fast, slow],
      handler: async () => {},
      connectFailure: "isolate",
      connectTimeoutMs: 100,
      onAdapterState: (p, s, r) => states.push([p, s, r]),
    });
    let settled = false;
    const started = runner.start().then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);
    expect(states).toEqual([["slack", "connected", undefined]]);
    await vi.advanceTimersByTimeAsync(50);
    const res = await started;
    expect(res.connected).toEqual(["slack"]);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0]?.platform).toBe("telegram");
    expect(states[1]?.[0]).toBe("telegram");
    expect(states[1]?.[1]).toBe("timed_out");
    expect([...runner.connected]).toEqual(["slack"]);
  });

  it("disconnects an adapter whose connect() resolves true after the timeout", async () => {
    vi.useFakeTimers();
    const slow = new HangingAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [slow],
      handler: async () => {},
      connectFailure: "isolate",
      connectTimeoutMs: 100,
    });
    const started = runner.start();
    await vi.advanceTimersByTimeAsync(100);
    await started;
    slow.settle(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(slow.disconnectCount).toBe(1);
    expect(slow.inboundWired).toBe(false);
    expect(runner.connected.size).toBe(0);
  });

  it("retries a timed-out adapter when reconnect is set", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const slow = new HangingAdapter("telegram");
    const states: AdapterState[] = [];
    const runner = new GatewayRunner({
      adapters: [slow],
      handler: async () => {},
      connectFailure: "isolate",
      connectTimeoutMs: 100,
      reconnect: { initialDelayMs: 50 },
      onAdapterState: (_p, s) => states.push(s),
    });
    const started = runner.start();
    await vi.advanceTimersByTimeAsync(100);
    await started;
    await vi.advanceTimersByTimeAsync(50);
    expect(slow.connectCount).toBe(2);
    expect(states).toContain("retrying");
    await runner.stop();
    vi.restoreAllMocks();
  });
});

describe("secrets", () => {
  it("masks an exact value in StartResult.failed and onAdapterState", async () => {
    const seen: Array<string | undefined> = [];
    const runner = new GatewayRunner({
      adapters: [new ThrowingAdapter("slack", "bad token abc-secret-xyz here")],
      handler: async () => {},
      connectFailure: "isolate",
      secrets: ["abc-secret-xyz"],
      onAdapterState: (_p, _s, r) => seen.push(r),
    });
    const res = await runner.start();
    expect(res.failed[0]?.reason).toBe("bad token [redacted] here");
    expect(seen).toEqual(["bad token [redacted] here"]);
  });
});
