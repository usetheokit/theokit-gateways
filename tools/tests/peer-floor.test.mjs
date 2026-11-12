import { describe, expect, it } from "vitest";

import { floorOf, publishableAdapters, runChecks } from "../../scripts/check-peer-floor.mjs";

describe("check-peer-floor", () => {
  it("reads the exact floor from a range", () => {
    expect(floorOf(">=0.15.0 <1.0.0")).toBe("0.15.0");
    expect(floorOf("^1.0.0")).toBeUndefined();
    expect(floorOf(undefined)).toBeUndefined();
  });

  it("collects the failures of a check instead of stopping at the first", async () => {
    const failures = await runChecks([{ label: "a" }, { label: "b" }], (c) => {
      if (c.label === "a") throw new Error("does not provide an export named 'SeenIds'");
    });
    expect(failures).toEqual([
      { label: "a", message: "does not provide an export named 'SeenIds'" },
    ]);
  });

  it("finds every adapter with a readable floor, and the twelve raised floors", () => {
    const byName = Object.fromEntries(publishableAdapters().map((a) => [a.name, a.floor]));
    for (const a of Object.values(byName)) expect(a).toMatch(/^\d+\.\d+\.\d+$/);
    expect(byName["@theokit/gateway-zalo"]).toBe("0.15.0");
    expect(byName["@theokit/gateway-qq"]).toBe("0.16.0");
    expect(byName["@theokit/gateway-buzz"]).toBe("0.14.0");
  });
});
