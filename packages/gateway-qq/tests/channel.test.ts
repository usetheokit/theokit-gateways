import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
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

function signed(event: object): { rawBody: string; headers: Record<string, string> } {
  const rawBody = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    rawBody,
    headers: { "X-Signature-Ed25519": signQQ(SECRET, ts + rawBody), "X-Signature-Timestamp": ts },
  };
}

describe("qqChannel descriptor", () => {
  it("declares a webhook transport and its config", () => {
    expect(qqChannel.transport).toBe("webhook");
    expect(qqChannel.platform).toBe("qq");
    expect(qqChannel.config.map((f) => f.key)).toEqual(["appId", "appSecret"]);
  });

  it("creates an adapter, and refuses a non-string or empty field", () => {
    expect(qqChannel.create(CONFIG)).toBeInstanceOf(QQAdapter);
    expect(() => qqChannel.create({ ...CONFIG, appId: 1 })).toThrow(/config\.appId/);
    expect(() => qqChannel.create({ ...CONFIG, appSecret: "" })).toThrow(/appSecret/);
  });
});

describe("qqChannel.webhook", () => {
  it("verifies a signed request, with any header case", () => {
    const adapter = qqChannel.create(CONFIG);
    const { rawBody, headers } = signed(TEXT);
    expect(qqChannel.webhook.verify(adapter, { rawBody, headers })).toBe(true);
    const lower = {
      "x-signature-ed25519": headers["X-Signature-Ed25519"],
      "x-signature-timestamp": headers["X-Signature-Timestamp"],
    };
    expect(qqChannel.webhook.verify(adapter, { rawBody, headers: lower })).toBe(true);
  });

  it("rejects a missing or wrong signature", () => {
    const adapter = qqChannel.create(CONFIG);
    const { rawBody, headers } = signed(TEXT);
    expect(qqChannel.webhook.verify(adapter, { rawBody, headers: {} })).toBe(false);
    const bad = { ...headers, "X-Signature-Ed25519": "00" };
    expect(qqChannel.webhook.verify(adapter, { rawBody, headers: bad })).toBe(false);
  });

  it("ingests a C2C text event, skips others, and reports malformed and no_handler", async () => {
    const adapter = qqChannel.create(CONFIG);
    expect(await qqChannel.webhook.ingest(adapter, TEXT)).toBe("no_handler");
    const texts: string[] = [];
    adapter.onInbound(async (e) => void texts.push(e.text ?? ""));
    expect(await qqChannel.webhook.ingest(adapter, TEXT)).toBe("delivered");
    expect(texts).toEqual(["hi"]);
    expect(await qqChannel.webhook.ingest(adapter, { op: 0, t: "OTHER" })).toBe("delivered");
    expect(await qqChannel.webhook.ingest(adapter, null)).toBe("malformed");
  });
});

function setup(subscribe: boolean) {
  const result = createChannels([
    { descriptor: qqChannel as unknown as ChannelDescriptor, config: CONFIG },
  ]);
  const adapter = result.adapters[0] as unknown as QQAdapter;
  const delivered: string[] = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e.text ?? ""));
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered };
}

const post = (rawBody: string, headers: Record<string, string> = {}) =>
  new Request("https://bot.test/webhooks/qq", { method: "POST", body: rawBody, headers });

describe("qq webhook through createWebhookHandler", () => {
  it("delivers a signed event and answers 200", async () => {
    const { handler, delivered } = setup(true);
    const { rawBody, headers } = signed(TEXT);
    expect((await handler(post(rawBody, headers))).status).toBe(200);
    expect(delivered).toEqual(["hi"]);
  });

  it("answers 401 for a bad signature and delivers nothing", async () => {
    const { handler, delivered } = setup(true);
    const { rawBody, headers } = signed(TEXT);
    const res = await handler(post(rawBody, { ...headers, "x-signature-ed25519": "00" }));
    expect(res.status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 503 when no handler is subscribed", async () => {
    const { handler } = setup(false);
    const { rawBody, headers } = signed(TEXT);
    expect((await handler(post(rawBody, headers))).status).toBe(503);
  });

  it("answers the unsigned callback URL validation with the signed plain_token", async () => {
    const { handler } = setup(true);
    const body = JSON.stringify({ op: 13, d: { plain_token: "tok123", event_ts: "1700000000" } });
    const res = await handler(post(body));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      plain_token: "tok123",
      signature: signQQ(SECRET, "1700000000tok123"),
    });
  });
});
