import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { qqChannel } from "../src/channel.js";
import { signQQ } from "../src/index.js";

const CONFIG = { appId: "a", appSecret: "secret" };
const payload = {
  op: 0,
  t: "C2C_MESSAGE_CREATE",
  d: {
    id: "m1",
    content: " hi",
    timestamp: "2026-11-11T10:00:00+08:00",
    author: { user_openid: "u1" },
  },
};

function signedRequest(raw: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    rawBody: raw,
    headers: { "X-Signature-Ed25519": signQQ("secret", ts + raw), "x-signature-timestamp": ts },
  };
}

describe("qqChannel", () => {
  it("is a webhook channel with the credentials as config", () => {
    expect(qqChannel.transport).toBe("webhook");
    expect(qqChannel.config.map((f) => f.key)).toEqual(["appId", "appSecret"]);
    expect(() => qqChannel.create({ ...CONFIG, appId: 1 })).toThrow(/config.appId/);
  });

  it("verifies a signed request and rejects a tampered or unsigned one", () => {
    const adapter = qqChannel.create(CONFIG);
    const req = signedRequest(JSON.stringify(payload));
    expect(qqChannel.webhook.verify(adapter, req)).toBe(true);
    expect(qqChannel.webhook.verify(adapter, { ...req, rawBody: "{}" })).toBe(false);
    expect(qqChannel.webhook.verify(adapter, { rawBody: req.rawBody, headers: {} })).toBe(false);
  });

  it("dispatches a text message, reports malformed and no_handler", async () => {
    const adapter = qqChannel.create(CONFIG);
    expect(await qqChannel.webhook.ingest(adapter, payload)).toBe("no_handler");
    const seen: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e);
    });
    expect(await qqChannel.webhook.ingest(adapter, payload)).toBe("delivered");
    expect(seen.map((e) => e.text)).toEqual(["hi"]);
    expect(await qqChannel.webhook.ingest(adapter, { op: 11 })).toBe("delivered");
    expect(await qqChannel.webhook.ingest(adapter, null)).toBe("malformed");
    expect(await qqChannel.webhook.ingest(adapter, "x")).toBe("malformed");
    expect(seen).toHaveLength(1);
  });

  it("handle answers the callback URL validation with a signed body", async () => {
    const adapter = qqChannel.create(CONFIG);
    const raw = JSON.stringify({ op: 13, d: { plain_token: "tok", event_ts: "123" } });
    const answer = await qqChannel.webhook.handle(adapter, { rawBody: raw, headers: {} });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body ?? "")).toEqual({
      plain_token: "tok",
      signature: signQQ("secret", "123tok"),
    });
  });

  it("handle answers 401 to an unsigned event and 503 to a signed one with no handler", async () => {
    const adapter = qqChannel.create(CONFIG);
    const raw = JSON.stringify(payload);
    expect((await qqChannel.webhook.handle(adapter, { rawBody: raw, headers: {} })).status).toBe(
      401,
    );
    expect((await qqChannel.webhook.handle(adapter, signedRequest(raw))).status).toBe(503);
  });
});
