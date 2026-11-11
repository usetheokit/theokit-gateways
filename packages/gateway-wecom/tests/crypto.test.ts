import { describe, expect, it } from "vitest";
import { computeWeComSignature } from "../src/crypto.js";

describe("WeCom signature", () => {
  it("sorts mixed-case inputs by byte order", () => {
    // sha1("1700000000" + "Beta" + "Zeta" + "alpha"): uppercase sorts before lowercase.
    expect(computeWeComSignature("Zeta", "1700000000", "alpha", "Beta")).toBe(
      "018aa59a146db7765677065766f62dc57c14feab",
    );
  });
});
