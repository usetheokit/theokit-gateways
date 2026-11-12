import { describe, expect, it } from "vitest";
import { computeWeChatSignature, verifyWeChatSignature } from "../src/signature.js";

describe("WeChat signature", () => {
  it("sorts mixed-case inputs by byte order", () => {
    // sha1("1700000000" + "Zeta" + "alpha"): uppercase sorts before lowercase.
    const expected = "51b94a7ec2e827006d18b9cf6690ac5e35430412";
    expect(computeWeChatSignature("Zeta", "1700000000", "alpha")).toBe(expected);
    expect(
      verifyWeChatSignature(
        "Zeta",
        {
          signature: expected,
          timestamp: "1700000000",
          nonce: "alpha",
        },
        1_700_000_000_000,
      ),
    ).toBe(true);
  });
});
