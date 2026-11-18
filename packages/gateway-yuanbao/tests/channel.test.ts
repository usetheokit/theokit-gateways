import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { yuanbaoChannel } from "../src/channel.js";
import { computeYuanbaoSignature } from "../src/index.js";

const CONFIG = { appId: "a", appSecret: "s", callbackSecret: "cb" };
const payload = {
  type: "message",
  message: { id: "m1", from: { id: "u1" }, text: "hi", create_time: 1 },
};

function signedRequest(raw: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    rawBody: raw,
    headers: { "X-Signature": computeYuanbaoSignature("cb", ts, raw), "x-timestamp": ts },
  };
}

describe("yuanbaoChannel", () => {
  it("is a webhook channel with the credentials as config", () => {
    expect(yuanbaoChannel.transport).toBe("webhook");
    expect(yuanbaoChannel.config.map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
      "callbackSecret",
    ]);
    expect(() => yuanbaoChannel.create({ ...CONFIG, appId: 1 })).toThrow(/config.appId/);
  });

  it("verifies a signed request and rejects a tampered or unsigned one", () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    const req = signedRequest(JSON.stringify(payload));
    expect(yuanbaoChannel.webhook.verify(adapter, req)).toBe(true);
    expect(yuanbaoChannel.webhook.verify(adapter, { ...req, rawBody: "{}" })).toBe(false);
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody: req.rawBody, headers: {} })).toBe(
      false,
    );
  });

  it("dispatches a text message, reports malformed and no_handler", async () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    expect(await yuanbaoChannel.webhook.ingest(adapter, payload)).toBe("no_handler");
    const seen: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e);
    });
    expect(await yuanbaoChannel.webhook.ingest(adapter, payload)).toBe("delivered");
    expect(seen.map((e) => e.text)).toEqual(["hi"]);
    expect(await yuanbaoChannel.webhook.ingest(adapter, { type: "other" })).toBe("delivered");
    expect(await yuanbaoChannel.webhook.ingest(adapter, "x")).toBe("malformed");
    expect(await yuanbaoChannel.webhook.ingest(adapter, [])).toBe("malformed");
    expect(seen).toHaveLength(1);
  });
});
