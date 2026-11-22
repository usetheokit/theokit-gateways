import { describe, expect, it } from "vitest";
import { ReconnectBackoff } from "../../src/index.js";

const take = (b: ReconnectBackoff, n: number) => Array.from({ length: n }, () => b.nextDelayMs());

describe("ReconnectBackoff", () => {
  it("grows and caps", () => {
    const b = new ReconnectBackoff({ initialDelayMs: 1000, maxDelayMs: 30000 });
    expect(take(b, 7)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it("uses documented defaults", () => {
    expect(take(new ReconnectBackoff(), 3)).toEqual([1000, 2000, 4000]);
  });

  it("resets after a stable connection, keeps growing otherwise", () => {
    let t = 0;
    const b = new ReconnectBackoff({ stableAfterMs: 60_000, now: () => t });
    take(b, 3);
    b.opened();
    t += 59_999;
    expect(b.nextDelayMs()).toBe(8000);
    b.opened();
    t += 60_000;
    expect(b.nextDelayMs()).toBe(1000);
    expect(b.nextDelayMs()).toBe(2000);
  });

  it("reset() returns to the initial delay", () => {
    const b = new ReconnectBackoff();
    take(b, 3);
    b.reset();
    expect(b.nextDelayMs()).toBe(1000);
  });

  it("returns undefined once maxAttempts is spent", () => {
    const b = new ReconnectBackoff({ maxAttempts: 2 });
    expect(take(b, 3)).toEqual([1000, 2000, undefined]);
  });

  it.each([
    ["initialDelayMs", { initialDelayMs: -1 }],
    ["initialDelayMs", { initialDelayMs: Number.NaN }],
    ["maxDelayMs", { maxDelayMs: -5 }],
    ["maxDelayMs", { maxDelayMs: Number.POSITIVE_INFINITY }],
    ["factor", { factor: 0.5 }],
  ])("throws RangeError naming %s", (field, opts) => {
    expect(() => new ReconnectBackoff(opts)).toThrow(RangeError);
    expect(() => new ReconnectBackoff(opts)).toThrow(field);
  });
});
