/**
 * Error mapper tests (T4.1).
 */

import { describe, expect, it } from "vitest";

import { mapWhatsAppCloudError, mapWhatsAppWebError } from "../src/errors.js";

describe("mapWhatsAppCloudError", () => {
  it("test_map_cloud_error_190_to_auth_failed", () => {
    const e = mapWhatsAppCloudError(401, { error: { code: 190, message: "expired" } });
    expect(e.code).toBe("auth_failed");
  });

  it("test_map_cloud_error_130_to_rate_limit", () => {
    // Kept for the HTTP-429 path, which is what this assertion was ever really
    // exercising. The code it passes is fabricated — see the block below.
    const e = mapWhatsAppCloudError(429, { error: { code: 130, message: "throttle" } });
    expect(e.code).toBe("rate_limit");
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
    expect(mapWhatsAppWebError(undefined).code).toBe("unknown");
  });
});
