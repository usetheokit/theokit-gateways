/**
 * `smsWebhookVerifier` — the SMS half of a framework channel webhook.
 *
 * The three provider signature schemes live in this package and are tested in
 * `backend-signature.test.ts`. What is under test HERE is the bridge: that the context handed to
 * them is built correctly from a Fetch `Request`, and that the two ways a verification can answer
 * "no" stay distinguishable.
 */

import { describe, expect, it, vi } from "vitest";

import { SMSAdapter } from "../src/adapter.js";
import type { SignatureContext } from "../src/backend-types.js";
import { smsWebhookVerifier } from "../src/webhook-verifier.js";

/** An adapter stand-in that records the context it was given and answers however the test says. */
function spyAdapter(answer: boolean, publicUrl?: string) {
  const seen: SignatureContext[] = [];
  return {
    seen,
    publicUrl,
    verifySignature: vi.fn((ctx: SignatureContext) => {
      seen.push(ctx);
      return answer;
    }),
  };
}

const post = (body: string, headers: Record<string, string> = {}): Request =>
  new Request("http://10.0.0.7:3000/sms/twilio", { method: "POST", headers, body });

describe("smsWebhookVerifier", () => {
  it("accepts a delivery the backend verifies", async () => {
    const adapter = spyAdapter(true);
    const result = await smsWebhookVerifier(adapter)(post("From=%2B5511&Body=hi"));

    expect(result.ok).toBe(true);
  });

  it("refuses one the backend rejects, and says why", async () => {
    const adapter = spyAdapter(false);
    const result = await smsWebhookVerifier(adapter)(post("From=%2B5511&Body=hi"));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("signature mismatch");
  });

  it("hands the backend the RAW body, byte for byte", async () => {
    // Every provider signs the exact bytes. A body that was parsed and re-serialised — even into
    // something equivalent — hashes differently and fails verification for a correct request.
    const raw = "From=%2B5511999999999&Body=hello+there&NumMedia=0";
    const adapter = spyAdapter(true);
    await smsWebhookVerifier(adapter)(post(raw));

    expect(adapter.seen[0]?.rawBody).toBe(raw);
  });

  it("reaches the backend under the lowercased name, however the provider wrote it", async () => {
    // `SignatureContext.headers` is documented as a lowercased map and every backend reads it that
    // way — Twilio looks up `x-twilio-signature`. The guarantee comes from the Fetch `Headers`
    // object, which normalises names on the way in; this asserts the guarantee rather than any code
    // in the verifier, which is why the verifier does not lowercase anything itself.
    const adapter = spyAdapter(true);
    await smsWebhookVerifier(adapter)(post("Body=hi", { "X-Twilio-Signature": "sig-1" }));

    expect(adapter.seen[0]?.headers["x-twilio-signature"]).toBe("sig-1");
  });

  it("signs against the configured public URL, not the address the request arrived on", async () => {
    // Twilio signs the URL. Behind a proxy or a tunnel the request's own URL is the INTERNAL one —
    // here `http://10.0.0.7:3000/...` — and comparing against it fails every genuine delivery.
    // This is the case `publicUrl` was declared for, and until 2026-08-31 nothing read it.
    const adapter = spyAdapter(true, "https://bot.example.com/sms/twilio");
    await smsWebhookVerifier(adapter)(post("Body=hi"));

    expect(adapter.seen[0]?.url).toBe("https://bot.example.com/sms/twilio");
  });

  it("lets the caller override the URL when the adapter's is not the one in play", async () => {
    const adapter = spyAdapter(true, "https://bot.example.com/sms/twilio");
    await smsWebhookVerifier(adapter, { publicUrl: "https://staging.example.com/sms/twilio" })(
      post("Body=hi"),
    );

    expect(adapter.seen[0]?.url).toBe("https://staging.example.com/sms/twilio");
  });

  it("takes publicUrl from a real adapter's options, which is what makes that option true", async () => {
    // Not a stand-in: a real `SMSAdapter`, to prove the field is populated from the constructor
    // rather than only existing on the interface this file declares.
    const adapter = new SMSAdapter({
      backend: "twilio",
      accountSid: "AC-sid",
      authToken: "auth-token",
      fromNumber: "+5511888888888",
      publicUrl: "https://bot.example.com/sms/twilio",
    });

    expect(adapter.publicUrl).toBe("https://bot.example.com/sms/twilio");
  });

  it("refuses everything before connect(), because the provider SDK is not loaded yet", async () => {
    // The trap, pinned rather than papered over. `TwilioBackend.verifySignature` opens with
    // `if (this.twilio === undefined) return false`, and the SDK loads during `connect()`. A
    // verifier wired before that answers 401 to every genuine delivery, and the reason it gives is
    // the same one a forged request gets — the backend contract returns a boolean and there is
    // nothing here to tell them apart with.
    const adapter = new SMSAdapter({
      backend: "twilio",
      accountSid: "AC-sid",
      authToken: "auth-token",
      fromNumber: "+5511888888888",
      publicUrl: "https://bot.example.com/sms/twilio",
    });

    const result = await smsWebhookVerifier(adapter)(
      post("Body=hi", { "x-twilio-signature": "s" }),
    );

    expect(result.ok).toBe(false);
  });

  it("falls back to the request URL when nothing else says otherwise", async () => {
    const adapter = spyAdapter(true);
    await smsWebhookVerifier(adapter)(post("Body=hi"));

    expect(adapter.seen[0]?.url).toBe("http://10.0.0.7:3000/sms/twilio");
  });
});
