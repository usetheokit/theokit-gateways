import { describe, expect, it } from "vitest";

import {
  computeYuanbaoSignature,
  verifyYuanbaoSignature,
  YUANBAO_TOLERANCE_S,
} from "../src/signature.js";

const NOW_S = 1_800_000_000;
const NOW_MS = NOW_S * 1000;

describe("verifyYuanbaoSignature", () => {
  const body = '{"a":1}';
  const ts = String(NOW_S);
  const sig = computeYuanbaoSignature("s3cret", ts, body);

  it("accepts a matching signature", () => {
    expect(verifyYuanbaoSignature("s3cret", body, sig, ts, NOW_MS)).toBe(true);
  });

  it("rejects a wrong secret, body or missing values", () => {
    expect(verifyYuanbaoSignature("other", body, sig, ts, NOW_MS)).toBe(false);
    expect(verifyYuanbaoSignature("s3cret", "{}", sig, ts, NOW_MS)).toBe(false);
    expect(verifyYuanbaoSignature("s3cret", body, undefined, ts, NOW_MS)).toBe(false);
    expect(verifyYuanbaoSignature("s3cret", body, sig, undefined, NOW_MS)).toBe(false);
  });

  it("enforces the timestamp window", () => {
    const edge = String(NOW_S - YUANBAO_TOLERANCE_S);
    const stale = String(NOW_S - YUANBAO_TOLERANCE_S - 1);
    expect(
      verifyYuanbaoSignature(
        "s3cret",
        body,
        computeYuanbaoSignature("s3cret", edge, body),
        edge,
        NOW_MS,
      ),
    ).toBe(true);
    expect(
      verifyYuanbaoSignature(
        "s3cret",
        body,
        computeYuanbaoSignature("s3cret", stale, body),
        stale,
        NOW_MS,
      ),
    ).toBe(false);
  });

  it("returns false for an empty secret", () => {
    expect(
      verifyYuanbaoSignature("", body, computeYuanbaoSignature("", ts, body), ts, NOW_MS),
    ).toBe(false);
  });
});
