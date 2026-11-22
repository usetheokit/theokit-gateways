import crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { tokensMatch } from "../src/token.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tokensMatch", () => {
  it("accepts the same token", () => {
    expect(tokensMatch("abc123", "abc123")).toBe(true);
  });

  it("refuses a token that differs only in its last byte", () => {
    expect(tokensMatch("abc123", "abc124")).toBe(false);
  });

  it("refuses a token of another length without comparing", () => {
    const compare = vi.spyOn(crypto, "timingSafeEqual");

    expect(tokensMatch("abc123", "abc1234")).toBe(false);
    expect(compare).not.toHaveBeenCalled();
  });

  it("refuses an empty token without throwing", () => {
    expect(tokensMatch("abc123", "")).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
  });
});
