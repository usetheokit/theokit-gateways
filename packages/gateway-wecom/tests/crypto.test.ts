import { describe, expect, it } from "vitest";
import { computeWeComSignature, verifyWeComSignature } from "../src/crypto.js";

describe("WeCom signature", () => {
  it("refuses an empty signature without throwing", () => {
    expect(
      verifyWeComSignature("tok", { msg_signature: "", timestamp: "1", nonce: "n" }, "enc"),
    ).toBe(false);
  });

  it("sorts mixed-case inputs by byte order", () => {
    // sha1("1700000000" + "Beta" + "Zeta" + "alpha"): uppercase sorts before lowercase.
    expect(computeWeComSignature("Zeta", "1700000000", "alpha", "Beta")).toBe(
      "018aa59a146db7765677065766f62dc57c14feab",
    );
  });
});
