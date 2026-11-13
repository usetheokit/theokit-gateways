import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { twilioRequestVerifier } from "../src/twilio-verifier.js";

// Fixture from Twilio's "Validating requests" documentation.
const TOKEN = "12345";
const URL_ = "https://mycompany.com/myapp.php?foo=1&bar=2";
const BODY =
  "CallSid=CA1234567890ABCDE&Caller=%2B14158675310&Digits=1234&From=%2B14158675310&To=%2B18005551212";
const SIG = "GvWf1cFY/Q7PnoempGyD5oXAezc=";

function req(o: { url?: string; body?: string; sig?: string | null } = {}): Request {
  const headers: Record<string, string> = {};
  if (o.sig !== null) headers["X-Twilio-Signature"] = o.sig ?? SIG;
  return new Request(o.url ?? URL_, { method: "POST", headers, body: o.body ?? BODY });
}

describe("twilioRequestVerifier", () => {
  const verify = twilioRequestVerifier({ authToken: TOKEN });

  it("accepts the documented fixture", async () => {
    expect(await verify(req())).toEqual({ ok: true });
  });
  it("rejects a changed parameter", async () => {
    expect(await verify(req({ body: BODY.replace("1234&", "9999&") }))).toEqual({
      ok: false,
      reason: "signature mismatch",
    });
  });
  it("rejects a changed URL", async () => {
    expect(await verify(req({ url: "https://mycompany.com/other.php?foo=1&bar=2" }))).toEqual({
      ok: false,
      reason: "signature mismatch",
    });
  });
  it("rejects a missing header", async () => {
    expect(await verify(req({ sig: null }))).toEqual({
      ok: false,
      reason: "missing X-Twilio-Signature header",
    });
  });
  it("rejects a wrong token", async () => {
    const r = await twilioRequestVerifier({ authToken: "nope" })(req());
    expect(r.ok).toBe(false);
  });
  it("uses publicUrl instead of the request URL", async () => {
    const v = twilioRequestVerifier({ authToken: TOKEN, publicUrl: URL_ });
    expect(await v(req({ url: "http://10.0.0.7:3000/x" }))).toEqual({ ok: true });
  });
  it("signs every value of a repeated key", async () => {
    const body = "a=1&a=2&b=3";
    const sig = createHmac("sha1", TOKEN).update(`${URL_}a1a2b3`).digest("base64");
    expect(await verify(req({ body, sig }))).toEqual({ ok: true });
  });
});
