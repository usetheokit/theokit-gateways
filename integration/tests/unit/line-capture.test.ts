/**
 * The capture endpoint's policy — who is allowed to write into `.env`.
 *
 * `capture-line-user.ts` opens a PUBLIC `trycloudflare.com` URL and takes the
 * `source.userId` from whatever arrives. It answered `200` to everything and
 * verified nothing (#35), while `LINE_CHANNEL_SECRET` — the credential that
 * exists precisely to authenticate these deliveries — was already in `.env` and
 * already read by the registry.
 *
 * So a third party who found the URL during its short life could POST a forged
 * `source.userId` and have it written to disk. The window is small and the
 * target obscure; the check is one function that this repository already ships
 * (`verifyLineSignature`, D408). Obscurity was doing the work a credential was
 * available to do.
 *
 * The ordering below is the security property, not a style choice: the body is
 * NOT parsed until the signature verifies. An unauthenticated request must
 * reach as little of our parsing as possible.
 */

import { computeLineSignature } from "@theokit/gateway-line";
import { describe, expect, it } from "vitest";

import { decideCapture, InvalidPortError, parseCapturePort } from "../../src/line-capture.js";

const SECRET = "channel-secret-for-tests";

/** A well-formed LINE delivery, signed the way LINE signs it. */
function signedDelivery(body: string): { rawBody: string; signatureHeader: string } {
  return { rawBody: body, signatureHeader: computeLineSignature(SECRET, body) };
}

const FOLLOW_EVENT = JSON.stringify({
  events: [{ type: "message", source: { type: "user", userId: "U0123456789abcdef" } }],
});

describe("decideCapture", () => {
  it("accepts a correctly signed delivery and returns its user id", () => {
    const { rawBody, signatureHeader } = signedDelivery(FOLLOW_EVENT);

    const decision = decideCapture({ channelSecret: SECRET, rawBody, signatureHeader });

    expect(decision).toEqual({ accepted: true, userId: "U0123456789abcdef" });
  });

  it("rejects a delivery signed with the wrong secret", () => {
    // The forgery case. Before the fix this was written straight into .env.
    const rawBody = FOLLOW_EVENT;
    const signatureHeader = computeLineSignature("not-our-secret", rawBody);

    const decision = decideCapture({ channelSecret: SECRET, rawBody, signatureHeader });

    expect(decision).toEqual({ accepted: false, reason: "bad_signature" });
  });

  it("rejects a delivery with no signature header at all", () => {
    const decision = decideCapture({
      channelSecret: SECRET,
      rawBody: FOLLOW_EVENT,
      signatureHeader: undefined,
    });

    expect(decision).toEqual({ accepted: false, reason: "bad_signature" });
  });

  it("rejects a body whose bytes changed after signing", () => {
    // Signature covers the RAW body; re-serialising the parsed JSON changes the
    // bytes. This asserts we compare against what actually arrived.
    const { signatureHeader } = signedDelivery(FOLLOW_EVENT);
    const tampered = FOLLOW_EVENT.replace("U0123456789abcdef", "Udeadbeefdeadbeef");

    const decision = decideCapture({
      channelSecret: SECRET,
      rawBody: tampered,
      signatureHeader,
    });

    expect(decision).toEqual({ accepted: false, reason: "bad_signature" });
  });

  it("does not parse the body when the signature fails", () => {
    // THE ordering guarantee. Malformed JSON with a bad signature must be
    // reported as bad_signature — reporting malformed_body would prove the
    // parser ran on unauthenticated input.
    const decision = decideCapture({
      channelSecret: SECRET,
      rawBody: "}{ not json at all",
      signatureHeader: "AAAA",
    });

    expect(decision).toEqual({ accepted: false, reason: "bad_signature" });
  });

  it("reports a malformed body only once it is authenticated", () => {
    const { rawBody, signatureHeader } = signedDelivery("}{ not json at all");

    const decision = decideCapture({ channelSecret: SECRET, rawBody, signatureHeader });

    expect(decision).toEqual({ accepted: false, reason: "malformed_body" });
  });

  it("reports an authenticated delivery that carries no user id", () => {
    // LINE really does deliver these — a group leave event has no source.userId.
    // The old script printed "waiting for another", which was right; this keeps
    // that behaviour distinguishable from a rejection.
    const { rawBody, signatureHeader } = signedDelivery(
      JSON.stringify({ events: [{ type: "leave", source: { type: "group" } }] }),
    );

    const decision = decideCapture({ channelSecret: SECRET, rawBody, signatureHeader });

    expect(decision).toEqual({ accepted: false, reason: "no_user_id" });
  });

  it("reports an empty event list as carrying no user id", () => {
    // LINE's webhook verification button sends exactly this.
    const { rawBody, signatureHeader } = signedDelivery(JSON.stringify({ events: [] }));

    const decision = decideCapture({ channelSecret: SECRET, rawBody, signatureHeader });

    expect(decision).toEqual({ accepted: false, reason: "no_user_id" });
  });

  it("takes the first event that has a user id, skipping those that do not", () => {
    const { rawBody, signatureHeader } = signedDelivery(
      JSON.stringify({
        events: [
          { type: "leave", source: { type: "group" } },
          { type: "message", source: { type: "user", userId: "Uffffffffffffffff" } },
        ],
      }),
    );

    const decision = decideCapture({ channelSecret: SECRET, rawBody, signatureHeader });

    expect(decision).toEqual({ accepted: true, userId: "Uffffffffffffffff" });
  });

  it("refuses a user id carrying a newline, which would inject a second .env variable", () => {
    // A signed-but-hostile payload is still hostile if the channel secret ever
    // leaks. The value lands in a `KEY=value` file other tooling parses, so it
    // is validated at this boundary rather than trusted for being authenticated.
    const { rawBody, signatureHeader } = signedDelivery(
      JSON.stringify({ events: [{ source: { userId: "U123\nINJECTED=1" } }] }),
    );

    const decision = decideCapture({ channelSecret: SECRET, rawBody, signatureHeader });

    expect(decision).toEqual({ accepted: false, reason: "no_user_id" });
  });

  it("refuses a non-string user id without throwing", () => {
    // JSON is authenticated, not typed. `userId: 42` reaching String() would
    // write "42" to .env; reaching .test() on a number would throw inside a
    // request handler.
    const { rawBody, signatureHeader } = signedDelivery(
      JSON.stringify({ events: [{ source: { userId: 42 } }] }),
    );

    const decision = decideCapture({ channelSecret: SECRET, rawBody, signatureHeader });

    expect(decision).toEqual({ accepted: false, reason: "no_user_id" });
  });

  it("accepts an id whose alphabet we do not presume to know", () => {
    // Guards against over-tightening: gateway-line types userId as a plain
    // string and its fixtures use `U-alice`. Rejecting that shape would be this
    // module inventing a format LINE never promised us.
    const { rawBody, signatureHeader } = signedDelivery(
      JSON.stringify({ events: [{ source: { userId: "U-alice_01" } }] }),
    );

    const decision = decideCapture({ channelSecret: SECRET, rawBody, signatureHeader });

    expect(decision).toEqual({ accepted: true, userId: "U-alice_01" });
  });

  it("refuses an empty channel secret rather than verifying against nothing", () => {
    // Edge case worth failing loudly on: HMAC with an empty key is a valid
    // computation and would happily "verify" a forged request signed the same
    // way. Missing configuration must not degrade into weak acceptance.
    const decision = decideCapture({
      channelSecret: "",
      rawBody: FOLLOW_EVENT,
      signatureHeader: computeLineSignature("", FOLLOW_EVENT),
    });

    expect(decision).toEqual({ accepted: false, reason: "bad_signature" });
  });
});

describe("parseCapturePort", () => {
  it("defaults when the variable is unset", () => {
    expect(parseCapturePort(undefined)).toBe(8787);
  });

  it("accepts a valid port", () => {
    expect(parseCapturePort("9000")).toBe(9000);
  });

  it("accepts the boundaries of the valid range", () => {
    expect(parseCapturePort("1")).toBe(1);
    expect(parseCapturePort("65535")).toBe(65535);
  });

  it.each(["", "  ", "not-a-port", "80a", "NaN"])("refuses a non-numeric value: %j", (raw) => {
    // The old code did `Number(raw ?? "8787")`, so "abc" became NaN and
    // `server.listen(NaN)` bound a RANDOM port. The tunnel then pointed at a
    // port where nothing listened, and the failure surfaced minutes later as
    // "LINE never delivered" — a diagnosis pointing at the wrong system.
    expect(() => parseCapturePort(raw)).toThrow(InvalidPortError);
  });

  it.each(["0", "-1", "65536", "8787.5"])("refuses an out-of-range value: %j", (raw) => {
    expect(() => parseCapturePort(raw)).toThrow(InvalidPortError);
  });

  it("names the variable and the offending value in the error", () => {
    expect(() => parseCapturePort("wat")).toThrow(/LINE_CAPTURE_PORT/);
    expect(() => parseCapturePort("wat")).toThrow(/wat/);
  });
});
