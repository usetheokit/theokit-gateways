/**
 * Two start() calls issued before the first resolves must share one connect.
 */

import { describe, expect, it } from "vitest";

import { GatewayRunner } from "../../src/runner/gateway-runner.js";
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

async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`never happened: ${what}`);
    await new Promise((r) => setTimeout(r, 1));
  }
}

async function connectCountAfterTwoOverlappingStarts(
  connectFailure: "rollback" | "isolate",
): Promise<number> {
  const a = new HeldConnectAdapter("telegram");
  const runner = new GatewayRunner({ adapters: [a], handler: async () => {}, connectFailure });

  const first = runner.start();
  const second = runner.start();
  // Both calls are in flight before the connect is released: the window the guard misses.
  await waitFor(() => a.pendingConnects > 0, "the first connect() to be entered");
  a.release();
  await Promise.all([first, second]);
  await runner.stop();
  return a.connectCount;
}

describe("GatewayRunner.start() called twice before the first resolves", () => {
  it("connects_each_adapter_once_under_the_default_rollback_mode", async () => {
    const count = await connectCountAfterTwoOverlappingStarts("rollback");
    expect(count, "a second start() in flight connected the adapter again").toBe(1);
  });

  it("connects_each_adapter_once_under_the_isolate_mode", async () => {
    const count = await connectCountAfterTwoOverlappingStarts("isolate");
    expect(count, "a second start() in flight connected the adapter again").toBe(1);
  });

  it("shares_one_start_result_between_overlapping_calls", async () => {
    const a = new HeldConnectAdapter("telegram");
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });

    const first = runner.start();
    const second = runner.start();
    await waitFor(() => a.pendingConnects > 0, "the first connect() to be entered");
    a.release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    await runner.stop();

    expect(firstResult, "the overlapping calls resolved different results").toBe(secondResult);
    expect(firstResult).toEqual({ connected: ["telegram"], failed: [] });
    expect(a.connectCount).toBe(1);
  });

  it("rejects_both_overlapping_calls_after_one_connect_when_rollback_fails", async () => {
    const a = new HeldConnectAdapter("telegram");
    a.connectResult = false;
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });

    // The catch sits on each start() call, so neither rejection is ever unhandled.
    const first = runner.start().catch((err: unknown) => err);
    const second = runner.start().catch((err: unknown) => err);
    await waitFor(() => a.pendingConnects > 0, "the first connect() to be entered");
    a.release();
    const [firstError, secondError] = await Promise.all([first, second]);
    await runner.stop();

    expect(firstError).toBeInstanceOf(Error);
    expect((firstError as Error).message).toContain("connect returned false");
    expect(secondError, "the overlapping calls rejected with different errors").toBe(firstError);
    expect(a.connectCount).toBe(1);
  });

  it("connects_again_after_a_rollback_failure", async () => {
    const a = new MockAdapter("telegram");
    a.connectResult = false;
    const runner = new GatewayRunner({ adapters: [a], handler: async () => {} });

    await expect(runner.start()).rejects.toThrow("connect returned false");
    a.connectResult = true;
    const result = await runner.start();
    await runner.stop();

    expect(result).toEqual({ connected: ["telegram"], failed: [] });
    expect(a.connectCount).toBe(2);
  });
});
