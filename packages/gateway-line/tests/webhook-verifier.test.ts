import { describe, expect, it } from "vitest";

import { computeLineSignature, lineWebhookVerifier } from "../src/index.js";

const SECRET = "channel-secret";
const BODY = JSON.stringify({ events: [] });
const post = (headers: Record<string, string>): Request =>
  new Request("http://localhost/line", { method: "POST", headers, body: BODY });

describe("lineWebhookVerifier", () => {
  it("accepts a correctly signed request", async () => {
    const sig = computeLineSignature(SECRET, BODY);
    expect(await lineWebhookVerifier(SECRET)(post({ "X-Line-Signature": sig }))).toEqual({
      ok: true,
    });
  });

  it("accepts an adapter as the secret source", async () => {
    const sig = computeLineSignature(SECRET, BODY);
    const v = lineWebhookVerifier({ getChannelSecret: () => SECRET });
    expect(await v(post({ "x-line-signature": sig }))).toEqual({ ok: true });
  });

  it("refuses a wrong signature", async () => {
    const r = await lineWebhookVerifier(SECRET)(post({ "x-line-signature": "nope" }));
    expect(r).toEqual({ ok: false, reason: "signature mismatch" });
  });

  it("refuses a missing header", async () => {
    const r = await lineWebhookVerifier(SECRET)(post({}));
    expect(r.ok).toBe(false);
  });
});
