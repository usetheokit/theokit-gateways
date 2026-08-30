/**
 * Error mapper tests (T4.1).
 */

import { describe, expect, it } from "vitest";

import { ConfigurationError, mapWhatsAppCloudError, mapWhatsAppWebError } from "../src/errors.js";

describe("ConfigurationError", () => {
  it("names this package in the message a caller did not write one for", () => {
    // The class is `@public`, and the prefix passed to `super` exists so a caller does not have to
    // type it. Every call site inside this package types it anyway, so the prefix argument is
    // reached by nothing — measured, emptying it killed no test. A consumer taking the default is
    // the one who meets it, and would get an error opening with ": " and naming no package.
    const e = new ConfigurationError({ code: "peer_missing" });

    expect(e.message).toBe("gateway-whatsapp: peer_missing");
    expect(e.name).toBe("ConfigurationError");
  });
});

describe("mapWhatsAppCloudError", () => {
  it("test_map_cloud_error_190_to_auth_failed", () => {
    const e = mapWhatsAppCloudError(401, { error: { code: 190, message: "expired" } });
    expect(e.code).toBe("auth_failed");
    // The code alone left the message branch unmeasured: removing it changes only the text, and
    // no test here read the text. "Bearer token rejected" is what tells a reader the credential
    // is the problem rather than the payload.
    expect(e.message).toContain("Bearer token rejected");
  });

  it("reports auth_failed from either signal, not only from the two together", () => {
    // `errCode === 190 || status === 401`. Every existing case sent BOTH, so mutating either
    // operand away left the other carrying the test. Meta is not obliged to send both.
    expect(mapWhatsAppCloudError(200, { error: { code: 190, message: "x" } }).code).toBe(
      "auth_failed",
    );
    expect(mapWhatsAppCloudError(401, { error: { code: 0, message: "x" } }).code).toBe(
      "auth_failed",
    );
  });

  it("test_map_cloud_error_130_to_rate_limit", () => {
    // Kept for the HTTP-429 path, which is what this assertion was ever really
    // exercising. The code it passes is fabricated — see the block below.
    const e = mapWhatsAppCloudError(429, { error: { code: 130, message: "throttle" } });
    expect(e.code).toBe("rate_limit");
    expect(e.message).toContain("Throttled");
  });

  // Every code below is copied from Meta's published error table, not invented.
  // The mapper used to test `errCode === 130 || errCode === 131`, which no Cloud
  // API response can ever satisfy: the codes in those families are six digits.
  // The branch was dead, and the test above passed on the status alone (#46).

  it("maps 131047 to session_window_expired, the one error with a different remedy", () => {
    // "More than 24 hours have passed since the recipient last replied." Meta's
    // own answer is to resend as a template. Collapsing it into invalid_request
    // erased the only actionable thing the response carried.
    const e = mapWhatsAppCloudError(400, {
      error: { code: 131047, message: "Re-engagement message" },
    });
    expect(e.code).toBe("session_window_expired");
    // The remedy is the reason this code is separated from invalid_request at all. Asserting only
    // the code left the sentence that carries it unprotected.
    expect(e.message).toContain("send an approved template instead");
  });

  it("maps 130429 — Cloud API throughput reached — to rate_limit", () => {
    const e = mapWhatsAppCloudError(400, {
      error: { code: 130429, message: "Cloud API message throughput has been reached" },
    });
    expect(e.code).toBe("rate_limit");
  });

  it("maps 80007 — WhatsApp Business Account rate limit — to rate_limit", () => {
    const e = mapWhatsAppCloudError(400, {
      error: { code: 80007, message: "rate limit hit" },
    });
    expect(e.code).toBe("rate_limit");
  });

  it("maps 4 — app-level API call rate limit — to rate_limit", () => {
    const e = mapWhatsAppCloudError(400, {
      error: { code: 4, message: "API rate limit reached" },
    });
    expect(e.code).toBe("rate_limit");
  });

  it("maps 131026 — undeliverable recipient — to undeliverable, not invalid_request", () => {
    // The payload was fine. Retrying it wastes calls against a recipient that
    // cannot receive, which is the opposite of what invalid_request suggests.
    const e = mapWhatsAppCloudError(400, {
      error: { code: 131026, message: "Unable to deliver message" },
    });
    expect(e.code).toBe("undeliverable");
  });

  it("maps 130403 — business has blocked the user — to undeliverable", () => {
    // A different cause with the same consequence for the caller: terminal, and
    // no retry will change it. The distinction lives in the message.
    const e = mapWhatsAppCloudError(400, {
      error: { code: 130403, message: "This business has blocked the end user" },
    });
    expect(e.code).toBe("undeliverable");
    expect(e.message).toContain("blocked");
  });

  it("test_map_cloud_error_4xx_to_invalid_request", () => {
    const e = mapWhatsAppCloudError(400, { error: { code: 100, message: "bad" } });
    expect(e.code).toBe("invalid_request");
  });

  it("maps 5xx to server_error", () => {
    const e = mapWhatsAppCloudError(503, { error: { message: "down" } });
    expect(e.code).toBe("server_error");
  });

  it("falls back to unknown", () => {
    const e = mapWhatsAppCloudError(418, { teapot: true });
    expect(e.code).toBe("unknown");
  });
});

describe("mapWhatsAppWebError", () => {
  it("test_map_web_error_protocol_to_server_error", () => {
    expect(mapWhatsAppWebError("PROTOCOL_ERROR").code).toBe("server_error");
  });

  it("test_map_web_error_auth_to_auth_failed", () => {
    expect(mapWhatsAppWebError("AUTHENTICATION_FAILURE").code).toBe("auth_failed");
  });

  it("maps RATE strings to rate_limit", () => {
    expect(mapWhatsAppWebError("RATE_LIMIT_HIT").code).toBe("rate_limit");
  });

  it("maps TIMEOUT to timeout", () => {
    expect(mapWhatsAppWebError("REQUEST TIMEOUT").code).toBe("timeout");
  });

  it("falls back to unknown for unrecognized", () => {
    expect(mapWhatsAppWebError("random thing").code).toBe("unknown");
  });

  it("handles undefined gracefully", () => {
    const e = mapWhatsAppWebError(undefined);
    expect(e.code).toBe("unknown");
    // "Gracefully" is a claim about the message too. The `?? "unknown bridge error"` fallback was
    // free to become "" with this test still green, and an error whose text is the empty string is
    // exactly what "handled gracefully" must not mean — the bridge failed and the log says nothing.
    expect(e.message, "the fallback left the error with no text at all").toBe(
      "unknown bridge error",
    );
  });
});

describe("mapWhatsAppCloudError — the recipient allowlist (131030)", () => {
  it("gives 131030 its own code, not the generic invalid_request", () => {
    // Same reasoning that earned 131047 its own code: the remedy is specific and different from
    // every other error here. "Recipient phone number not in allowed list" means the credential
    // set is incomplete — nobody registered this recipient against the test number — and the fix
    // is a console step, not a payload change. Collapsing it into `invalid_request` sends a
    // developer to re-read a payload that was correct.
    //
    // This is not an exotic case. Every Cloud API app starts on a free test number, whose
    // recipients must be registered one by one, so this is the first error most integrations
    // meet — and the one where a wrong diagnosis costs the most, because the payload looks fine.
    const e = mapWhatsAppCloudError(400, {
      error: {
        code: 131030,
        message: "(#131030) Recipient phone number not in allowed list",
      },
    });

    expect(e.code).toBe("recipient_not_allowlisted");
  });

  it("carries the remedy in the message, like the sibling it copies", () => {
    // A caller reading only the code knows to register the recipient; a human reading a log
    // should not have to look the number up. `session_window_expired` set that standard here.
    const e = mapWhatsAppCloudError(400, {
      error: { code: 131030, message: "(#131030) Recipient phone number not in allowed list" },
    });

    // Assert the text this branch ADDS, never text Meta already sent. The previous assertions
    // were `/allow(ed)? list/i` and "131030" — both already present in the input message above,
    // and the fallthrough returns that message verbatim. They passed whether or not this branch
    // ran, which is the one thing a test about a branch must not do.
    // BOTH halves of the concatenation. Mutation testing showed the first one could be emptied
    // with this test still green, because "WhatsApp API setup" lives in the second — an assertion
    // on half a sentence measures half a sentence.
    expect(e.message, "the first half of the remedy is missing").toContain(
      "not on this number's allowed list",
    );
    expect(e.message, "the second half of the remedy is missing").toContain("WhatsApp API setup");
    expect(e.message, "Meta's own text was dropped instead of appended to").toContain("131030");
  });

  it("reports invalid_request from either signal, not only from the two together", () => {
    // `status === 400 || errCode === 100`, and every existing case sent both — so each operand
    // could be deleted with the other still carrying the test.
    expect(mapWhatsAppCloudError(400, { error: { code: 0, message: "x" } }).code).toBe(
      "invalid_request",
    );
    expect(mapWhatsAppCloudError(200, { error: { code: 100, message: "x" } }).code).toBe(
      "invalid_request",
    );
  });

  it("treats HTTP 500 itself as a server error, not only what is above it", () => {
    // `status >= 500`. No case used exactly 500, so `>` and `>=` were indistinguishable — and 500
    // is the status Meta actually returns most. The first valid value at a boundary is the value
    // an off-by-one gets wrong.
    expect(mapWhatsAppCloudError(500, { error: { code: 0, message: "x" } }).code).toBe(
      "server_error",
    );
  });

  it("falls back to the status when Meta sends no message at all", () => {
    // `parsed.error?.message ?? \`HTTP ${status}\``. Every case here supplies a message, so the
    // fallback was never taken and could be emptied unnoticed — leaving an error whose text is
    // the empty string, which is the one thing a log reader cannot act on.
    const e = mapWhatsAppCloudError(503, {});

    expect(e.message).toContain("503");
  });

  it("does not paste the 24-hour remedy onto errors that are not about the window", () => {
    // `if (code === "session_window_expired")` mutated to `true` survived: every other test
    // asserted a substring that ALSO appears once the wrong remedy is prepended. An error telling
    // an operator to send a template when the recipient is simply unreachable sends them to spend
    // an afternoon on the wrong fix.
    const e = mapWhatsAppCloudError(400, {
      error: { code: 131026, message: "Unable to deliver message" },
    });

    expect(e.code).toBe("undeliverable");
    expect(e.message).not.toContain("approved template");
  });

  it("still maps an ordinary 400 to invalid_request", () => {
    // The new branch must not swallow the generic one it sits in front of: all of these arrive
    // as HTTP 400, and the specific code is the only thing separating them.
    const e = mapWhatsAppCloudError(400, {
      error: { code: 100, message: "Invalid parameter" },
    });

    expect(e.code).toBe("invalid_request");
  });
});
