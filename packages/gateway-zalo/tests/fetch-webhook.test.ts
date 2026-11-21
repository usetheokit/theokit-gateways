import { createWebhookHandler } from "@theokit/gateway";
import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { ZaloAdapter } from "../src/adapter.js";
import { zaloChannel } from "../src/channel.js";
import { computeZaloSignature } from "../src/signature.js";

const APP = "app1";
const SECRET = "oa-secret";
const CONFIG = { appId: APP, oaSecretKey: SECRET, accessToken: "tok" };
const TEXT = {
  app_id: APP,
  event_name: "user_send_text",
  sender: { id: "u1" },
  recipient: { id: "oa1" },
  message: { text: "hi", msg_id: "m1" },
  timestamp: "1700000000000",
};

function signedInit(event: object, secret = SECRET) {
  const body = JSON.stringify(event);
  const mac = computeZaloSignature(APP, body, TEXT.timestamp, secret);
  return { body, headers: { "x-zevent-signature": `mac=${mac}` } };
}
const badInit = (event: object) => signedInit(event, "wrong-secret");

function route(adapter: ZaloAdapter, started = true) {
  const handler = createWebhookHandler({
    channels: [{ descriptor: zaloChannel, adapter } as never],
    isStarted: () => started,
  });
  return (init: { body: string; headers: Record<string, string> }) =>
    handler(new Request("https://host.test/webhooks/zalo", { method: "POST", ...init }));
}

describe("zaloChannel over createWebhookHandler", () => {
  it("answers 200 and delivers a signed event", async () => {
    const adapter = zaloChannel.create(CONFIG);
    const events: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      events.push(e);
    });
    const res = await route(adapter)(signedInit(TEXT));
    expect(res.status).toBe(200);
    expect(events.map((e) => e.text)).toEqual(["hi"]);
  });

  it("refuses a wrong signature with 401 and delivers nothing", async () => {
    const adapter = zaloChannel.create(CONFIG);
    const events: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      events.push(e);
    });
    const res = await route(adapter)(badInit(TEXT));
    expect(res.status).toBe(401);
    expect(events).toEqual([]);
  });

  it("answers 503 for a signed message when nothing is subscribed", async () => {
    const res = await route(zaloChannel.create(CONFIG))(signedInit(TEXT));
    expect(res.status).toBe(503);
  });
});
