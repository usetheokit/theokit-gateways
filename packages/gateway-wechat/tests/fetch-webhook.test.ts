/** The WeChat descriptor's webhook driven through `createWebhookHandler` with real Fetch requests. */

import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { wechatChannel } from "../src/channel.js";
import { computeWeChatSignature } from "../src/signature.js";

const TOKEN = "test-callback-token";

function setup(subscribe: boolean) {
  const result = createChannels([
    {
      descriptor: wechatChannel as unknown as ChannelDescriptor,
      config: { appId: "wx-app", appSecret: "wx-secret", token: TOKEN },
    },
  ]);
  const adapter = result.adapters[0] as unknown as {
    onInbound(h: (e: unknown) => Promise<void>): () => void;
  };
  const delivered: Array<{ text?: string }> = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e as { text?: string }));
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered };
}

const xml = (id: string) =>
  `<xml><ToUserName>gh_1</ToUserName><FromUserName>openid-1</FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType>text</MsgType><Content>hello</Content><MsgId>${id}</MsgId></xml>`;

function url(extra: Record<string, string> = {}, key = TOKEN, nonce = "n1"): string {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const q = new URLSearchParams({
    signature: computeWeChatSignature(key, timestamp, nonce),
    timestamp,
    nonce,
    ...extra,
  });
  return `https://bot.test/webhooks/wechat?${q.toString()}`;
}

describe("wechat webhook through createWebhookHandler", () => {
  it("answers the server-URL check with the echostr", async () => {
    const { handler } = setup(true);
    const res = await handler(new Request(url({ echostr: "echo-123" })));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("echo-123");
  });

  it("delivers a signed text message and answers success", async () => {
    const { handler, delivered } = setup(true);
    const res = await handler(new Request(url(), { method: "POST", body: xml("m1") }));
    expect([res.status, await res.text()]).toEqual([200, "success"]);
    expect(delivered.map((e) => e.text)).toEqual(["hello"]);
  });

  it("refuses a wrong signature with 401 and delivers nothing", async () => {
    const { handler, delivered } = setup(true);
    const res = await handler(
      new Request(url({}, "other-token"), { method: "POST", body: xml("m2") }),
    );
    expect(res.status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 503 when no handler is subscribed", async () => {
    const { handler } = setup(false);
    const res = await handler(
      new Request(url({}, TOKEN, "n2"), { method: "POST", body: xml("m3") }),
    );
    expect(res.status).toBe(503);
  });

  it("refuses a method the route does not take", async () => {
    const { handler } = setup(true);
    expect((await handler(new Request(url(), { method: "PUT", body: "x" }))).status).toBe(405);
  });
});
