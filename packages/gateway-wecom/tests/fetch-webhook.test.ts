/** The WeCom descriptor's webhook driven through `createWebhookHandler` with real Fetch requests. */

import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { wecomChannel } from "../src/channel.js";
import { computeWeComSignature, encryptWeCom } from "../src/crypto.js";

const TOKEN = "test-callback-token";
const CORP_ID = "ww-corp";
const AES_KEY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

function setup(subscribe: boolean) {
  const result = createChannels([
    {
      descriptor: wecomChannel as unknown as ChannelDescriptor,
      config: {
        corpId: CORP_ID,
        corpSecret: "secret",
        agentId: "1000002",
        token: TOKEN,
        encodingAesKey: AES_KEY,
      },
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

const message = (id: string) =>
  `<xml><ToUserName>${CORP_ID}</ToUserName><FromUserName>user-1</FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType>text</MsgType><Content>hello</Content><MsgId>${id}</MsgId></xml>`;

function signedUrl(encrypted: string, extra: Record<string, string> = {}, key = TOKEN): string {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "n1";
  const q = new URLSearchParams({
    msg_signature: computeWeComSignature(key, timestamp, nonce, encrypted),
    timestamp,
    nonce,
    ...extra,
  });
  return `https://bot.test/webhooks/wecom?${q.toString()}`;
}

function post(id: string, key = TOKEN): Request {
  const encrypted = encryptWeCom(AES_KEY, message(id), CORP_ID);
  return new Request(signedUrl(encrypted, {}, key), {
    method: "POST",
    body: `<xml><Encrypt>${encrypted}</Encrypt></xml>`,
  });
}

describe("wecom webhook through createWebhookHandler", () => {
  it("answers the callback-URL check with the decrypted echostr", async () => {
    const { handler } = setup(true);
    const echostr = encryptWeCom(AES_KEY, "echo-123", CORP_ID);
    const res = await handler(new Request(signedUrl(echostr, { echostr })));
    expect([res.status, await res.text()]).toEqual([200, "echo-123"]);
  });

  it("delivers a signed encrypted message and answers success", async () => {
    const { handler, delivered } = setup(true);
    const res = await handler(post("m1"));
    expect([res.status, await res.text()]).toEqual([200, "success"]);
    expect(delivered.map((e) => e.text)).toEqual(["hello"]);
  });

  it("refuses a wrong signature with 401 and delivers nothing", async () => {
    const { handler, delivered } = setup(true);
    const res = await handler(post("m2", "other-token"));
    expect(res.status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 503 when no handler is subscribed", async () => {
    const { handler } = setup(false);
    expect((await handler(post("m3"))).status).toBe(503);
  });
});
