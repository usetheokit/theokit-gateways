import { describe, expect, it } from "vitest";

import { floorOf, main, publishableAdapters, runChecks } from "../../scripts/check-peer-floor.mjs";

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

describe("check-peer-floor main", () => {
  it("exits 1 when an import fails, naming the adapter, and 0 when all succeed", async () => {
    const calls = [];
    const argv = ["--adapter", "@theokit/gateway-zalo@0.1.0", "--core", "0.12.0"];
    const bad = await main(argv, {
      install: (c) => {
        calls.push(c);
        throw new Error("does not provide an export named 'SeenIds'");
      },
    });
    expect(bad).toBe(1);
    expect(calls).toEqual([
      {
        adapterSpec: "@theokit/gateway-zalo@0.1.0",
        adapterName: "@theokit/gateway-zalo",
        coreVersion: "0.12.0",
      },
    ]);
    expect(await main(argv, { install: () => {} })).toBe(0);
  });

  it("installs each workspace adapter at its own floor", async () => {
    const seen = {};
    const code = await main([], {
      pack: (dir) => dir,
      install: (c) => {
        seen[c.adapterName] = c.coreVersion;
      },
    });
    expect(code).toBe(0);
    expect(seen["@theokit/gateway-zalo"]).toBe("0.15.0");
    expect(seen["@theokit/gateway-qq"]).toBe("0.16.0");
  });

  it("rejects --adapter without --core", async () => {
    await expect(main(["--adapter", "x@1.0.0"], { install: () => {} })).rejects.toThrow("--core");
  });
});
