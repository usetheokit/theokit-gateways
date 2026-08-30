/**
 * Tests for mapSlackError → canonical SendResult mapping (ADR D273).
 */

import { describe, expect, it } from "vitest";
import { mapSlackError } from "../src/errors.js";

describe("mapSlackError", () => {
  it("maps rate_limited with retry_after", () => {
    const r = mapSlackError({ data: { error: "rate_limited", retry_after: 30 } });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("rate_limit");
    expect(r.error?.message).toContain("30");
  });

  it("maps channel_not_found", () => {
    const r = mapSlackError({ data: { error: "channel_not_found" } });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("channel_not_found");
  });

  it("maps not_in_channel + missing_scope to no_permission with needed/scope", () => {
    const r1 = mapSlackError({ data: { error: "not_in_channel" } });
    expect(r1.error?.code).toBe("no_permission");
    const r2 = mapSlackError({ data: { error: "missing_scope", needed: "chat:write" } });
    expect(r2.error?.code).toBe("no_permission");
    expect(r2.error?.message).toBe("chat:write");
  });

  it("maps invalid_auth + token_revoked + account_inactive to auth_error", () => {
    // `account_inactive` is the third label on the same switch case and had no test, so it could
    // fall through to platform_error unnoticed — reporting a revoked workspace member as a generic
    // platform fault, which sends an operator to check Slack's status page.
    for (const error of ["invalid_auth", "token_revoked", "account_inactive"]) {
      const r = mapSlackError({ data: { error } });
      expect(r.ok, `${error} did not report failure`).toBe(false);
      expect(r.error?.code, error).toBe("auth_error");
    }
  });

  it("maps msg_too_long + message_limit_exceeded to message_too_long", () => {
    // The name promised two and the body took one — `rules/testing.md` § 3 calls an "and" in a
    // test name a smell, and this is why: the untaken half was free to fall through.
    for (const error of ["msg_too_long", "message_limit_exceeded"]) {
      const r = mapSlackError({ data: { error } });
      expect(r.ok, `${error} did not report failure`).toBe(false);
      expect(r.error?.code, error).toBe("message_too_long");
    }
  });

  it("falls through unknown Slack errors to platform_error", () => {
    const r = mapSlackError({ data: { error: "some_new_code" }, message: "weird" });
    expect(r.error?.code).toBe("platform_error");
    expect(r.error?.message).toContain("some_new_code");
  });

  it("handles non-Slack error objects gracefully", () => {
    const r = mapSlackError(new Error("random"));
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("platform_error");
  });

  it("never reports success — an error mapper that returns ok:true hides the failure", () => {
    // `ok: false` survived mutation to `true` on three of the five branches, because most cases
    // read only `error.code`. A send that failed and reports `ok: true` is the worst possible
    // outcome of this function: the adapter tells the agent the message went out.
    const inputs: unknown[] = [
      { data: { error: "rate_limited", retry_after: 1 } },
      { data: { error: "channel_not_found" } },
      { data: { error: "missing_scope" } },
      { data: { error: "invalid_auth" } },
      { data: { error: "msg_too_long" } },
      { data: { error: "something_new" } },
      new Error("no data at all"),
      {},
    ];
    for (const input of inputs) {
      expect(mapSlackError(input).ok, JSON.stringify(input)).toBe(false);
    }
  });

  it("reads the code from wherever Slack put it, and names the fallback when it is nowhere", () => {
    // `e.data?.error ?? e.code ?? "platform_error"`. Every case supplied `data.error`, so the two
    // fallbacks were unreachable — including the literal that keeps an error with no code at all
    // from producing `undefined: ...` as its message.
    expect(mapSlackError({ code: "rate_limited", data: {} }).error?.code).toBe("rate_limit");
    expect(mapSlackError({}).error?.message).toContain("platform_error");
  });

  it("prefers `needed` over `scope`, and falls to the code when neither is there", () => {
    // The three-step chain `needed ?? scope ?? code`. Only the first step had a test.
    expect(
      mapSlackError({ data: { error: "missing_scope", needed: "chat:write" } }).error?.message,
    ).toBe("chat:write");
    expect(
      mapSlackError({ data: { error: "missing_scope", scope: "channels:read" } }).error?.message,
    ).toBe("channels:read");
    expect(mapSlackError({ data: { error: "not_in_channel" } }).error?.message).toBe(
      "not_in_channel",
    );
  });

  it("says `unknown` rather than `undefined` when the fallthrough error has no message", () => {
    expect(mapSlackError({ data: { error: "some_new_code" } }).error?.message).toBe(
      "some_new_code: unknown",
    );
  });

  it("says how long to wait, and says so even when Slack did not", () => {
    // `retry after ${e.data?.retry_after ?? "?"}s`. The `?? "?"` had no test, so a rate limit
    // without the header would have read "retry after undefineds".
    expect(mapSlackError({ data: { error: "rate_limited" } }).error?.message).toBe(
      "retry after ?s",
    );
  });
});
