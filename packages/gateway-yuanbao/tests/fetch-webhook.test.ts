import type { MessageEvent } from "@theokit/gateway";
import { createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import type { YuanbaoAdapter } from "../src/adapter.js";
import { yuanbaoChannel } from "../src/channel.js";
import { computeYuanbaoSignature } from "../src/signature.js";

const CALLBACK = "cb-secret";
const CONFIG = { appId: "app1", appSecret: "sec", callbackSecret: CALLBACK };
const TEXT = {
  type: "message",
  message: { id: "m1", text: "hi", from: { id: "u1" }, create_time: 1700000000 },
};

function signedInit(event: object, secret = CALLBACK) {
  const body = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    body,
    headers: { "x-signature": computeYuanbaoSignature(secret, ts, body), "x-timestamp": ts },
  };
}
const badInit = (event: object) => signedInit(event, "wrong-secret");

function route(adapter: YuanbaoAdapter, started = true) {
  const handler = createWebhookHandler({
    channels: [{ descriptor: yuanbaoChannel, adapter } as never],
    isStarted: () => started,
  });
  return (init: { body: string; headers: Record<string, string> }) =>
    handler(new Request("https://host.test/webhooks/yuanbao", { method: "POST", ...init }));
}

describe("yuanbaoChannel over createWebhookHandler", () => {
  it("answers 200 and delivers a signed event", async () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    const events: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      events.push(e);
    });
    const res = await route(adapter)(signedInit(TEXT));
    expect(res.status).toBe(200);
    expect(events.map((e) => e.text)).toEqual(["hi"]);
  });

  it("refuses a wrong signature with 401 and delivers nothing", async () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    const events: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      events.push(e);
    });
    const res = await route(adapter)(badInit(TEXT));
    expect(res.status).toBe(401);
    expect(events).toEqual([]);
  });

  it("answers 503 for a signed message when nothing is subscribed", async () => {
    const res = await route(yuanbaoChannel.create(CONFIG))(signedInit(TEXT));
    expect(res.status).toBe(503);
  });
});
