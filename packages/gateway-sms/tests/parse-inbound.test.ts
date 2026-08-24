/**
 * `parseInbound` — the SMS half of TheoKit's channel seam.
 *
 * The interesting cases here are not the happy path. They are the two ways an earlier version of
 * this function got the error boundary wrong, both found by calling it rather than by reading it:
 *
 *   - a single broad `catch` returned `null` for an invalid `fromNumber` in the app's OWN options,
 *     so a misconfigured deployment saw every message silently dropped with nothing to diagnose;
 *   - removing the catch made an empty webhook body throw out of `onMessage` — which TheoKit calls
 *     AFTER answering 200, so the throw is an unhandled rejection with no status left to change.
 *
 * `normalizeE164` raises the same `ConfigurationError` for a bad configured number and a bad number
 * in the body, so the two cannot be told apart by type. They are told apart by ORDER: the app's
 * configuration is validated first and allowed to throw; after that line, the same error can only
 * have come from the body.
 */

import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../src/errors.js";
import { parseInbound } from "../src/parse-inbound.js";
import type { SMSAdapterOptions } from "../src/types.js";

const OPTIONS: SMSAdapterOptions = {
  backend: "twilio",
  accountSid: "ACnotreal",
  authToken: "not-a-real-token",
  fromNumber: "+14155550123",
  publicUrl: "https://sms.invalid",
};

/** A real Twilio inbound webhook: form-encoded, exactly as posted. */
const CTX = {
  headers: {},
  url: "https://sms.invalid/sms",
  rawBody: "From=%2B14155550199&To=%2B14155550123&Body=ol%C3%A1&MessageSid=SM123",
};

describe("parseInbound", () => {
  it("translates a real Twilio form body into the canonical event", () => {
    const event = parseInbound(OPTIONS, CTX);

    expect(event).not.toBeNull();
    expect(event?.platform).toBe("sms");
    expect(event?.text).toBe("olá");
    expect(event?.sender.id).toBe("+14155550199");
    expect(event?.id).toBe("SM123");
  });

  it("returns null for an empty body", () => {
    expect(parseInbound(OPTIONS, { ...CTX, rawBody: "" })).toBeNull();
  });

  it("returns null for a body that is not form-encoded at all", () => {
    expect(parseInbound(OPTIONS, { ...CTX, rawBody: "this is not a form" })).toBeNull();
  });

  it("returns null when the body carries no message id", () => {
    const noId = "From=%2B14155550199&To=%2B14155550123&Body=hi";

    expect(parseInbound(OPTIONS, { ...CTX, rawBody: noId })).toBeNull();
  });

  it("THROWS on the app's own invalid configuration rather than returning null", () => {
    // The regression. Returning `null` here is the defect: a misconfigured deployment would see
    // every inbound message vanish, with the same value a malformed body produces.
    expect(() => parseInbound({ ...OPTIONS, fromNumber: "not-a-number" }, CTX)).toThrow(
      ConfigurationError,
    );
  });
});

describe("no throw escapes into onMessage", () => {
  it("returns null for a body containing a malformed percent-escape", () => {
    // The regression. `decodeURIComponent("%zz")` raises `URIError`, and an earlier version
    // re-threw anything that was not a `ConfigurationError` — so this escaped out of `onMessage`,
    // after TheoKit had already answered 200. Found because a mutation that should have gone red
    // stayed green, which is the only signal an untested branch gives.
    expect(
      parseInbound(OPTIONS, { ...CTX, rawBody: "From=%zz&Body=hi&MessageSid=SM1" }),
    ).toBeNull();
  });
});
