import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { zaloChannel } from "../src/channel.js";
import { computeZaloSignature } from "../src/index.js";

const CONFIG = { appId: "app", oaSecretKey: "sec", accessToken: "tok" };
const payload = {
  app_id: "app",
  event_name: "user_send_text",
  timestamp: "1700000000000",
  sender: { id: "u1" },
  recipient: { id: "oa" },
  message: { msg_id: "m1", text: "hi" },
};

function signedRequest(raw: string, ts = "1700000000000") {
  return {
    rawBody: raw,
    headers: { "X-ZEvent-Signature": `mac=${computeZaloSignature("app", raw, ts, "sec")}` },
  };
}

describe("zaloChannel", () => {
  it("is a webhook channel with the credentials as config", () => {
    expect(zaloChannel.transport).toBe("webhook");
    expect(zaloChannel.config.map((f) => f.key)).toEqual(["appId", "oaSecretKey", "accessToken"]);
    expect(() => zaloChannel.create({ ...CONFIG, accessToken: 1 })).toThrow(/config.accessToken/);
  });

  it("verifies a signed request and rejects a tampered or unsigned one", () => {
    const adapter = zaloChannel.create(CONFIG);
    const req = signedRequest(JSON.stringify(payload));
    expect(zaloChannel.webhook.verify(adapter, req)).toBe(true);
    expect(
      zaloChannel.webhook.verify(adapter, {
        ...req,
        rawBody: JSON.stringify({ ...payload, x: 1 }),
      }),
    ).toBe(false);
    expect(zaloChannel.webhook.verify(adapter, { rawBody: req.rawBody, headers: {} })).toBe(false);
  });

  it("dispatches a text message, reports malformed and no_handler", async () => {
    const adapter = zaloChannel.create(CONFIG);
    expect(await zaloChannel.webhook.ingest(adapter, payload)).toBe("no_handler");
    const seen: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e);
    });
    expect(await zaloChannel.webhook.ingest(adapter, payload)).toBe("delivered");
    expect(seen.map((e) => e.text)).toEqual(["hi"]);
    expect(await zaloChannel.webhook.ingest(adapter, { ...payload, event_name: "follow" })).toBe(
      "delivered",
    );
    expect(await zaloChannel.webhook.ingest(adapter, { ...payload, app_id: "other" })).toBe(
      "delivered",
    );
    expect(await zaloChannel.webhook.ingest(adapter, null)).toBe("malformed");
    expect(await zaloChannel.webhook.ingest(adapter, 5)).toBe("malformed");
    expect(seen).toHaveLength(1);
  });
});
