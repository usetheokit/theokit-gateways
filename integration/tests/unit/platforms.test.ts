import { describe, expect, it } from "vitest";
import { PLATFORMS } from "../../src/platforms.js";

describe("PLATFORMS", () => {
  it("derives each package from the id and reads every credential row whole", () => {
    for (const p of PLATFORMS) {
      expect(p.pkg).toBe(`@theokit/gateway-${p.id.replaceAll("_", "-")}`);
      for (const c of [...p.credentials, ...p.target]) {
        expect(c.name).toMatch(/^[A-Z][A-Z0-9_]+$/);
        expect(c.what).not.toBe("");
        expect(c.where).not.toBe("");
        expect(c.where).not.toContain(" :: ");
      }
    }
  });

  it("keeps optional fields absent when unset", () => {
    const telegram = PLATFORMS.find((p) => p.id === "telegram");
    expect(telegram).toBeDefined();
    expect("caveat" in (telegram ?? {})).toBe(false);
    expect("reachableVia" in (telegram ?? {})).toBe(false);
  });
});
