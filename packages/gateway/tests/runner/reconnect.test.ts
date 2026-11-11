/** `reconnect` on `GatewayRunner`: transient connect failures retry with backoff; credential errors do not. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { GatewayRunner } from "../../src/runner/gateway-runner.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

class FlakyAdapter extends MockAdapter {
  constructor(
    private readonly failures: number,
    private readonly error: Error,
  ) {
    super("matrix");
  }
  override async connect(): Promise<boolean> {
    this.connectCount += 1;
    if (this.connectCount <= this.failures) throw this.error;
    return true;
  }
}

afterEach(() => vi.useRealTimers());

function runner(adapter: MockAdapter) {
  return new GatewayRunner({
    adapters: [adapter],
    handler: async () => {},
    connectFailure: "isolate",
    reconnect: { initialDelayMs: 100, maxDelayMs: 200 },
  });
}

describe("reconnect policy", () => {
  it("retries a transient failure with capped backoff until it connects", async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = new FlakyAdapter(3, new Error("fetch failed"));
    const r = runner(adapter);
    const res = await r.start();
    expect(res.failed).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100); // attempt 1
    await vi.advanceTimersByTimeAsync(200); // attempt 2
    expect(adapter.connectCount).toBe(3);
    await vi.advanceTimersByTimeAsync(200); // attempt 3 (capped) connects
    expect(adapter.connectCount).toBe(4);
    const logs = err.mock.calls.map((c) => String(c[0])).join("");
    expect(logs).toContain("reconnect attempt 2");
    expect(logs).toContain("connected on attempt 3");
    await r.stop();
    err.mockRestore();
  });

  it("does not retry a credential error", async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = new FlakyAdapter(5, Object.assign(new Error("denied"), { status: 401 }));
    const r = runner(adapter);
    await r.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(adapter.connectCount).toBe(1);
    await r.stop();
    err.mockRestore();
  });

  it("stops retrying after stop()", async () => {
    vi.useFakeTimers();
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = new FlakyAdapter(5, new Error("ECONNREFUSED"));
    const r = runner(adapter);
    await r.start();
    await r.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(adapter.connectCount).toBe(1);
    err.mockRestore();
  });
});
