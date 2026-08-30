/**
 * Error mapper tests (T5.1 + EC-7 pattern).
 */

import { describe, expect, it } from "vitest";

import { mapEmailError } from "../src/errors.js";

describe("mapEmailError", () => {
  it("test_map_smtp_eauth_to_auth_failed", () => {
    expect(mapEmailError({ code: "EAUTH", message: "Invalid login" }).code).toBe("auth_failed");
  });

  it("test_map_smtp_econnection_to_server_error", () => {
    expect(mapEmailError({ code: "ECONNECTION", message: "Connection refused" }).code).toBe(
      "server_error",
    );
  });

  it("test_map_smtp_550_to_invalid_request", () => {
    expect(mapEmailError({ code: "EENVELOPE", message: "550 No such user" }).code).toBe(
      "invalid_request",
    );
  });

  it("test_map_smtp_response_code_535_to_auth_failed", () => {
    expect(mapEmailError({ responseCode: 535, message: "auth fail" }).code).toBe("auth_failed");
  });

  it("test_map_smtp_response_code_421_to_rate_limit", () => {
    expect(mapEmailError({ responseCode: 421 }).code).toBe("rate_limit");
  });

  it("test_map_imap_auth_failed", () => {
    expect(mapEmailError({ name: "IMAP_AUTH_FAILED", message: "auth failed" }).code).toBe(
      "auth_failed",
    );
  });

  it("test_map_plain_error_econnrefused_to_server_error", () => {
    expect(mapEmailError(new Error("connect ECONNREFUSED 0.0.0.0:993")).code).toBe("server_error");
  });

  it("test_map_null_to_unknown", () => {
    expect(mapEmailError(null).code).toBe("unknown");
    expect(mapEmailError(undefined).code).toBe("unknown");
  });

  it("test_map_string_to_unknown", () => {
    expect(mapEmailError("oops").code).toBe("unknown");
  });

  it("test_map_etimedout_to_timeout", () => {
    expect(mapEmailError({ code: "ETIMEDOUT", message: "timeout" }).code).toBe("timeout");
  });
});

/**
 * The ladder, exhaustively.
 *
 * The tests above take one representative per branch, which leaves every OTHER alternative of every
 * `||` free. Measured by mutation testing on 2026-08-30: 29 mutants survived in this file, and they
 * were almost all the untaken alternatives — `EAUTHENTICATION` beside `EAUTH`, `ESOCKET` and `ETLS`
 * beside `ECONNECTION`, 530 beside 535, 451 and 452 beside 421, and the two numeric fallthroughs
 * that no case reached at all.
 *
 * The mapper's own comment calls the ladder exhaustive. A table is what makes the test exhaustive
 * too, and it keeps one row per behaviour rather than one assertion per branch buried in a loop.
 */
describe("mapEmailError — every rung of the ladder", () => {
  const cases: Array<[string, unknown, string]> = [
    // nodemailer codes — each alternative of each disjunction, not just the first.
    ["EAUTH", { code: "EAUTH", message: "Invalid login" }, "auth_failed"],
    ["EAUTHENTICATION", { code: "EAUTHENTICATION", message: "Invalid login" }, "auth_failed"],
    [
      "EENVELOPE carrying 550",
      { code: "EENVELOPE", message: "550 No such user" },
      "invalid_request",
    ],
    // EENVELOPE is an AND: the code alone is not enough, and without the 550 it is not a rejected
    // recipient but an envelope problem the ladder has no specific answer for.
    ["EENVELOPE without 550", { code: "EENVELOPE", message: "no recipients defined" }, "unknown"],
    ["ECONNECTION", { code: "ECONNECTION", message: "Connection refused" }, "server_error"],
    ["ESOCKET", { code: "ESOCKET", message: "socket hang up" }, "server_error"],
    ["ETLS", { code: "ETLS", message: "certificate has expired" }, "server_error"],
    ["ETIMEDOUT", { code: "ETIMEDOUT", message: "Greeting never received" }, "timeout"],

    // SMTP response codes. Named ones first, then the two numeric fallthroughs.
    [
      "535 Authentication failed",
      { responseCode: 535, message: "5.7.8 Bad credentials" },
      "auth_failed",
    ],
    [
      "530 Authentication required",
      { responseCode: 530, message: "5.7.0 Must issue STARTTLS" },
      "auth_failed",
    ],
    [
      "421 Service not available",
      { responseCode: 421, message: "4.7.0 Try again later" },
      "rate_limit",
    ],
    ["451 Local error", { responseCode: 451, message: "4.3.0 Try again later" }, "rate_limit"],
    [
      "452 Insufficient storage",
      { responseCode: 452, message: "4.2.2 Mailbox full" },
      "rate_limit",
    ],
    [
      "550 Mailbox unavailable",
      { responseCode: 550, message: "5.1.1 No such user" },
      "invalid_request",
    ],
    [
      "551 User not local",
      { responseCode: 551, message: "5.1.6 Try forwarding" },
      "invalid_request",
    ],
    [
      "553 Mailbox name not allowed",
      { responseCode: 553, message: "5.1.3 Bad address" },
      "invalid_request",
    ],
    // The fallthroughs: any other 5xx is the server's fault, any other 4xx is transient. Nothing
    // reached either, so `>= 500` and `>= 400` were indistinguishable from `> 500` and `> 400`.
    ["an unlisted 5xx", { responseCode: 554, message: "5.7.1 Transaction failed" }, "server_error"],
    ["500 exactly", { responseCode: 500, message: "5.5.1 Command unrecognized" }, "server_error"],
    ["an unlisted 4xx", { responseCode: 450, message: "4.2.0 Mailbox busy" }, "rate_limit"],
    ["400 exactly", { responseCode: 400, message: "bad sequence" }, "rate_limit"],

    // The last rungs, reached only when nothing above matched.
    [
      "an imapflow auth failure by name",
      { name: "IMAP_AUTH_FAILED", message: "no" },
      "auth_failed",
    ],
    ["anything whose text mentions auth", new Error("AUTHENTICATE failed"), "auth_failed"],
    ["a bare network error", new Error("connect ECONNREFUSED 0.0.0.0:993"), "server_error"],
    ["something the ladder cannot place", new Error("who knows"), "unknown"],
  ];

  it.each(cases)("maps %s to %s", (_name, input, expected) => {
    expect(mapEmailError(input).code).toBe(expected);
  });

  it("carries the original text through every rung, because that text is the diagnostic", () => {
    // Every branch returns `message`, and no test read one. The whole ladder could have returned
    // the empty string with all of the above still green — leaving a typed error whose code says
    // "auth_failed" and whose text says nothing about WHICH credential the server rejected.
    expect(
      mapEmailError({ code: "EAUTH", message: "535 5.7.8 Username and Password not accepted" })
        .message,
    ).toBe("535 5.7.8 Username and Password not accepted");
    expect(
      mapEmailError({ responseCode: 421, message: "4.7.0 Too many connections" }).message,
    ).toBe("4.7.0 Too many connections");
  });

  it("says something rather than nothing when the failure carries no text at all", () => {
    // `message` falls back to `String(err)` when the error has none, and to "Unknown error" for
    // null/undefined. Both fallbacks were free to become "" — an error with an empty message is
    // the one a reader cannot act on, which is the state fail-clear exists to prevent.
    expect(mapEmailError(null).message).toBe("Unknown error");
    expect(mapEmailError(undefined).message).toBe("Unknown error");
    expect(mapEmailError("connection reset by peer").message).toBe("connection reset by peer");
    expect(mapEmailError({ code: "EAUTH" }).message.length).toBeGreaterThan(0);
  });
});
