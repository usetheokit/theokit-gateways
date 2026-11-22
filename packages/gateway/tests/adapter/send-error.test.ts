import { describe, expect, expectTypeOf, it } from "vitest";
import { type SendError, type SendErrorCode, sendErrorFromHttp } from "../../src/index.js";

describe("sendErrorFromHttp", () => {
  it("maps 429 with seconds", () => {
    expect(sendErrorFromHttp(429, "slow", { retryAfter: "3" })).toEqual({
      ok: false,
      error: { code: "rate_limit", message: "slow", retryAfterMs: 3000 },
    });
  });
  it("maps 429 with an HTTP date", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const r = sendErrorFromHttp(429, "x", {
      retryAfter: new Date(now + 10_000).toUTCString(),
      now: () => now,
    });
    expect(r.error?.retryAfterMs).toBe(10000);
  });
  it.each([
    [401, "auth_failed"],
    [403, "permission_denied"],
    [408, "timeout"],
    [500, "server_error"],
    [503, "server_error"],
    [418, "platform_error"],
  ])("maps %i to %s", (status, code) => {
    const r = sendErrorFromHttp(status, "m", { platformCode: "P" });
    expect(r.ok).toBe(false);
    expect(r.error).toEqual({ code, message: "m", platformCode: "P" });
  });
  it.each(["abc", "-1", null, undefined])("ignores retryAfter %s", (v) => {
    expect(sendErrorFromHttp(429, "m", { retryAfter: v }).error?.retryAfterMs).toBeUndefined();
  });
  it.each([99, 600, 200.5, Number.NaN])("throws RangeError for %s", (s) => {
    expect(() => sendErrorFromHttp(s, "m")).toThrow(/status/);
    expect(() => sendErrorFromHttp(s, "m")).toThrow(RangeError);
  });
  it("accepts a platform-specific code", () => {
    const e: SendError = { code: "some_platform_code", message: "" };
    expect(e.code).toBe("some_platform_code");
    expectTypeOf<"rate_limit">().toMatchTypeOf<SendErrorCode>();
  });
});
