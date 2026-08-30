/**
 * Error mapper tests (T4.1 + EC-7).
 */

import { describe, expect, it } from "vitest";

import { mapTeamsError } from "../src/errors.js";

describe("mapTeamsError", () => {
  it("test_map_401_to_auth_failed", () => {
    expect(mapTeamsError({ status: 401, message: "no token" }).code).toBe("auth_failed");
  });

  it("test_map_403_to_auth_failed", () => {
    expect(mapTeamsError({ status: 403, message: "forbidden" }).code).toBe("auth_failed");
  });

  it("test_map_429_to_rate_limit", () => {
    expect(mapTeamsError({ status: 429 }).code).toBe("rate_limit");
  });

  it("test_map_400_to_invalid_request", () => {
    expect(mapTeamsError({ status: 400 }).code).toBe("invalid_request");
  });

  it("test_map_5xx_to_server_error", () => {
    expect(mapTeamsError({ status: 503 }).code).toBe("server_error");
  });

  it("test_map_unknown_to_unknown", () => {
    expect(mapTeamsError({ status: 418 }).code).toBe("unknown");
  });

  it("test_map_handles_string_input", () => {
    expect(mapTeamsError("oops").code).toBe("unknown");
  });

  it("test_map_handles_null", () => {
    expect(mapTeamsError(null).code).toBe("unknown");
    expect(mapTeamsError(undefined).code).toBe("unknown");
  });

  it("test_map_plain_error_without_status (EC-7) — ECONNREFUSED → server_error", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:3978");
    const m = mapTeamsError(err);
    expect(m.code).toBe("server_error");
    expect(m.message).toContain("ECONNREFUSED");
  });

  it("test_map_plain_error_without_status_unknown_message → unknown", () => {
    expect(mapTeamsError(new Error("random failure")).code).toBe("unknown");
  });

  it("test_map_handles_statusCode_field (EC-7) — alternative name", () => {
    expect(mapTeamsError({ statusCode: 401 }).code).toBe("auth_failed");
    expect(mapTeamsError({ statusCode: 429 }).code).toBe("rate_limit");
  });
});

/**
 * The status ladder, rung by rung.
 *
 * The cases above take one status per branch and none of the boundaries. Measured by mutation
 * testing on 2026-08-30: `408` and `404` were reachable by nothing, `>= 500` was indistinguishable
 * from `> 500` because no case used exactly 500, and a status the ladder does NOT recognise never
 * met the code that falls past it.
 */
describe("mapTeamsError — every rung of the status ladder", () => {
  const cases: Array<[number, string]> = [
    [401, "auth_failed"],
    [403, "auth_failed"],
    [429, "rate_limit"],
    [408, "timeout"],
    [400, "invalid_request"],
    [404, "invalid_request"],
    // 500 exactly is the first valid value of the `>= 500` branch, and the one an off-by-one gets
    // wrong. 503 is the status a throttled or restarting Bot Framework actually returns.
    [500, "server_error"],
    [503, "server_error"],
  ];

  it.each(cases)("maps status %i to %s", (status, expected) => {
    expect(mapTeamsError({ status, message: "x" }).code).toBe(expected);
  });

  it("falls past a status it does not recognise instead of inventing a code for it", () => {
    // `codeForTeamsStatus` returns undefined and the ladder continues to the network-text check
    // and then to `unknown`. Nothing reached that path: every case used a status the ladder knows.
    expect(mapTeamsError({ status: 302, message: "moved" }).code).toBe("unknown");
    // ...and a status it does not know still lets the network check speak, which is the reason the
    // ladder continues rather than returning early.
    expect(mapTeamsError({ status: 302, message: "fetch failed" }).code).toBe("server_error");
  });

  it("carries the original text through, and says something when there is none", () => {
    // Every branch returns `message`, and only one case read it. The `String(err)` fallback for an
    // error with no message, and the "Unknown error" for null, were both free to become "" — an
    // error whose code is set and whose text is empty is the one a reader cannot act on.
    expect(mapTeamsError({ status: 401, message: "token expired at 12:04" }).message).toBe(
      "token expired at 12:04",
    );
    expect(mapTeamsError(null).message).toBe("Unknown error");
    expect(mapTeamsError(undefined).message).toBe("Unknown error");
    expect(mapTeamsError("a bare string").message).toBe("a bare string");
    expect(mapTeamsError({ status: 500 }).message.length).toBeGreaterThan(0);
  });
});
