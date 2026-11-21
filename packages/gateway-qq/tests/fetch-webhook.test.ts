import { createWebhookHandler } from "@theokit/gateway";
import type { MessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { QQAdapter } from "../src/adapter.js";
import { qqChannel } from "../src/channel.js";
import { signQQ } from "../src/signature.js";

const SECRET = "qq-secret";
const CONFIG = { appId: "app1", appSecret: SECRET };
const TEXT = {
  op: 0,
  t: "C2C_MESSAGE_CREATE",
  d: {
    id: "m1",
    content: " hi ",
    author: { user_openid: "u1" },
    timestamp: "2024-01-01T00:00:00Z",
  },
};

function signedInit(event: object, secret = SECRET) {
  const body = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    body,
    headers: { "x-signature-ed25519": signQQ(secret, ts + body), "x-signature-timestamp": ts },
  };
}
const badInit = (event: object) => signedInit(event, "wrong-secret");

function route(adapter: QQAdapter, started = true) {
  const handler = createWebhookHandler({
    channels: [{ descriptor: qqChannel, adapter } as never],
    isStarted: () => started,
  });
  return (init: { body: string; headers: Record<string, string> }) =>
    handler(new Request("https://host.test/webhooks/qq", { method: "POST", ...init }));
}

describe("qqChannel over createWebhookHandler", () => {
  it("answers 200 and delivers a signed event", async () => {
    const adapter = qqChannel.create(CONFIG);
    const events: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      events.push(e);
    });
    const res = await route(adapter)(signedInit(TEXT));
    expect(res.status).toBe(200);
    expect(events.map((e) => e.text)).toEqual(["hi"]);
  });

  it("refuses a wrong signature with 401 and delivers nothing", async () => {
    const adapter = qqChannel.create(CONFIG);
    const events: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      events.push(e);
    });
    const res = await route(adapter)(badInit(TEXT));
    expect(res.status).toBe(401);
    expect(events).toEqual([]);
  });

  it("answers 503 for a signed message when nothing is subscribed", async () => {
    const res = await route(qqChannel.create(CONFIG))(signedInit(TEXT));
    expect(res.status).toBe(503);
  });

  it("answers the callback URL validation with a JSON body", async () => {
    const body = JSON.stringify({ op: 13, d: { plain_token: "tok123", event_ts: "1700000000" } });
    const res = await route(qqChannel.create(CONFIG))({ body, headers: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toMatchObject({ plain_token: "tok123" });
  });
});
