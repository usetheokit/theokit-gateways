import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { YuanbaoAdapter } from "../src/adapter.js";
import { yuanbaoChannel } from "../src/channel.js";
import { computeYuanbaoSignature } from "../src/signature.js";

const CALLBACK = "cb-secret";
const CONFIG = { appId: "app1", appSecret: "sec", callbackSecret: CALLBACK };

const TEXT = {
  type: "message",
  message: { id: "m1", text: "hi", from: { id: "u1" }, create_time: 1700000000 },
};

function signed(event: object): { rawBody: string; headers: Record<string, string> } {
  const rawBody = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    rawBody,
    headers: {
      "X-Signature": computeYuanbaoSignature(CALLBACK, ts, rawBody),
      "X-Timestamp": ts,
    },
  };
}

describe("yuanbaoChannel descriptor", () => {
  it("declares a webhook transport and its config", () => {
    expect(yuanbaoChannel.transport).toBe("webhook");
    expect(yuanbaoChannel.platform).toBe("yuanbao");
    expect(yuanbaoChannel.config.map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
      "callbackSecret",
    ]);
  });

  it("creates an adapter, and refuses a non-string or empty field", () => {
    expect(yuanbaoChannel.create(CONFIG)).toBeInstanceOf(YuanbaoAdapter);
    expect(() => yuanbaoChannel.create({ ...CONFIG, appId: 1 })).toThrow(/config\.appId/);
    expect(() => yuanbaoChannel.create({ ...CONFIG, callbackSecret: "" })).toThrow(
      /callbackSecret/,
    );
  });
});

describe("yuanbaoChannel.webhook", () => {
  it("verifies a signed request, with any header case", () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    const { rawBody, headers } = signed(TEXT);
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody, headers })).toBe(true);
    const lower = { "x-signature": headers["X-Signature"], "x-timestamp": headers["X-Timestamp"] };
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody, headers: lower })).toBe(true);
  });

  it("rejects a missing or wrong signature", () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    const { rawBody, headers } = signed(TEXT);
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody, headers: {} })).toBe(false);
    const bad = { "X-Signature": "00", "X-Timestamp": headers["X-Timestamp"] };
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody, headers: bad })).toBe(false);
  });

  it("ingests a text event, skips others, and reports malformed and no_handler", async () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    expect(await yuanbaoChannel.webhook.ingest(adapter, TEXT)).toBe("no_handler");
    const texts: string[] = [];
    adapter.onInbound(async (e) => void texts.push(e.text ?? ""));
    expect(await yuanbaoChannel.webhook.ingest(adapter, TEXT)).toBe("delivered");
    expect(texts).toEqual(["hi"]);
    expect(await yuanbaoChannel.webhook.ingest(adapter, { type: "other" })).toBe("delivered");
    expect(await yuanbaoChannel.webhook.ingest(adapter, null)).toBe("malformed");
    expect(await yuanbaoChannel.webhook.ingest(adapter, [])).toBe("malformed");
  });
});

function setup(subscribe: boolean) {
  const result = createChannels([
    { descriptor: yuanbaoChannel as unknown as ChannelDescriptor, config: CONFIG },
  ]);
  const adapter = result.adapters[0] as unknown as YuanbaoAdapter;
  const delivered: string[] = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e.text ?? ""));
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered };
}

const post = (rawBody: string, headers: Record<string, string>) =>
  new Request("https://bot.test/webhooks/yuanbao", { method: "POST", body: rawBody, headers });

describe("yuanbao webhook through createWebhookHandler", () => {
  it("delivers a signed event and answers 200", async () => {
    const { handler, delivered } = setup(true);
    const { rawBody, headers } = signed(TEXT);
    expect((await handler(post(rawBody, headers))).status).toBe(200);
    expect(delivered).toEqual(["hi"]);
  });

  it("answers 401 for a bad signature and delivers nothing", async () => {
    const { handler, delivered } = setup(true);
    const { rawBody } = signed(TEXT);
    const res = await handler(post(rawBody, { "x-signature": "bad", "x-timestamp": "1" }));
    expect(res.status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 503 when no handler is subscribed", async () => {
    const { handler } = setup(false);
    const { rawBody, headers } = signed(TEXT);
    expect((await handler(post(rawBody, headers))).status).toBe(503);
  });

  it("refuses a method the route does not take", async () => {
    const { handler } = setup(true);
    const res = await handler(new Request("https://bot.test/webhooks/yuanbao"));
    expect(res.status).toBe(405);
  });
});
