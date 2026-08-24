/**
 * `parseInbound` — the SMS half of TheoKit's channel seam.
 *
 * The interesting cases here are not the happy path. They are the two ways an earlier version of
 * this function got the error boundary wrong, both found by calling it rather than by reading it:
 *
 *   - a single broad `catch` returned `null` for an invalid `fromNumber` in the app's OWN options,
 *     so a misconfigured deployment saw every message silently dropped with nothing to diagnose;
 *   - removing the catch made an empty webhook body throw out of `onMessage` — which TheoKit calls
 *     BEFORE building the 200 and does not catch, so the 200 is never built and the route's own
 *     error boundary answers instead.
 *
 * The design that fixed those two was itself wrong, and review caught it: validating
 * `options.fromNumber` up front invented a rule stricter than anything else in this package applies
 * to that field, and rejected four documented configurations — a Vonage alphanumeric sender id, a
 * Twilio short code, a Messaging Service SID, and a national number with `defaultCountry` set.
 *
 * What ships instead: `createBackend` runs OUTSIDE the try, so an unsupported backend surfaces;
 * everything body-dependent runs inside it and returns `null`. `fromNumber` is validated nowhere,
 * exactly as the rest of the package treats it. An invalid `defaultCountry` remains
 * indistinguishable from a bad body and degrades to `null` — stated rather than papered over.
 */

import { describe, expect, it } from "vitest";

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

  it("THROWS on an unsupported backend rather than returning null", () => {
    // The configuration error that IS separable: `createBackend` runs outside the try, so a
    // backend nobody implemented surfaces instead of becoming the same `null` a bad body produces.
    expect(() => parseInbound({ ...OPTIONS, backend: "sendgrid" as never }, CTX)).toThrow();
  });

  it.each([
    ["a Vonage alphanumeric sender id", "ACME"],
    ["a Twilio short code", "12345"],
    ["a Messaging Service SID", "MG9752274e9470b73f5c"],
    ["a national number with defaultCountry set", "11999999999"],
  ])("accepts %s as fromNumber", (_label, fromNumber) => {
    // The regression for the review BLOCKER. An earlier version validated `fromNumber` up front
    // with `normalizeE164`, a rule stricter than anything else in this package applies to it, and
    // these four documented configurations each threw `ConfigurationError` out of `onMessage`
    // out of the route before it answered — the exact failure the check was meant to prevent.
    const options = { ...OPTIONS, fromNumber, defaultCountry: "BR" };

    expect(() => parseInbound(options, CTX)).not.toThrow();
    expect(parseInbound(options, CTX)?.text).toBe("olá");
  });
});

describe("no throw escapes into onMessage", () => {
  it("returns null for a body containing a malformed percent-escape", () => {
    // The regression. `decodeURIComponent("%zz")` raises `URIError`, and an earlier version
    // re-threw anything that was not a `ConfigurationError` — so this escaped out of `onMessage`,
    // before TheoKit answered at all. Found because a mutation that should have gone red
    // stayed green, which is the only signal an untested branch gives.
    expect(
      parseInbound(OPTIONS, { ...CTX, rawBody: "From=%zz&Body=hi&MessageSid=SM1" }),
    ).toBeNull();
  });
});

describe("the canonical event carries the backend that produced it", () => {
  it("records the configured backend on the event", () => {
    // Review found `event.sms.backend` asserted nowhere, so hardcoding it survived the suite.
    expect(parseInbound(OPTIONS, CTX)?.sms.backend).toBe("twilio");
  });
});

describe("what parseInbound does NOT do, stated so nobody assumes it", () => {
  it("does not verify the webhook signature", () => {
    // `SMSAdapter`'s constructor refuses an empty `authToken` because it would accept unsigned
    // webhooks. `parseInbound` accepts one, and that is correct HERE: TheoKit's channel seam
    // validates the signature before calling `onMessage`, so the body reaching this function is
    // already authenticated. An app calling it OUTSIDE that seam must verify first — asserted so
    // the difference is recorded rather than discovered.
    const unsigned = { ...OPTIONS, authToken: "" };

    expect(parseInbound(unsigned, CTX)?.text).toBe("olá");
  });
});
