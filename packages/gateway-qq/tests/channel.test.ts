import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { QQAdapter } from "../src/adapter.js";
import { qqChannel } from "../src/channel.js";
import { signQQ } from "../src/signature.js";

const CONFIG = { appId: "app1", appSecret: "secret-secret" };
const RAW = JSON.stringify({
  op: 0,
  t: "C2C_MESSAGE_CREATE",
  d: { id: "m1", content: "hi", timestamp: "2024-01-01T00:00:00Z", author: { user_openid: "u1" } },
});

function signed(raw = RAW): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  return { "x-signature-ed25519": signQQ(CONFIG.appSecret, ts + raw), "x-signature-timestamp": ts };
}

function setup(subscribe: boolean) {
  const result = createChannels([
    { descriptor: qqChannel as unknown as ChannelDescriptor, config: CONFIG },
  ]);
  const adapter = result.adapters[0] as unknown as QQAdapter;
  const delivered: unknown[] = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e));
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered, adapter, result };
}

const post = (raw: string, headers: Record<string, string>): Request =>
  new Request("https://example.test/webhooks/qq", { method: "POST", headers, body: raw });

describe("qqChannel", () => {
  it("declares webhook transport, POST only, and its config fields", () => {
    expect(qqChannel.transport).toBe("webhook");
    expect(qqChannel.webhook.methods).toEqual(["POST"]);
    expect(qqChannel.config.map((f) => f.key)).toEqual(["appId", "appSecret"]);
    expect(qqChannel.config.filter((f) => f.secret).map((f) => f.key)).toEqual(["appSecret"]);
  });

  it("builds the adapter and refuses a wrongly typed value", () => {
    const { result } = setup(false);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(QQAdapter);
    expect(() => qqChannel.create({ ...CONFIG, appId: 5 })).toThrow(/appId/);
  });

  it("verifies a valid signed event and dispatches it", async () => {
    const { handler, delivered } = setup(true);
    expect((await handler(post(RAW, signed()))).status).toBe(200);
    expect(delivered).toHaveLength(1);
  });

  it("verify and ingest work directly on the descriptor", async () => {
    const { adapter, delivered } = setup(true);
    const headers = Object.fromEntries(
      Object.entries(signed()).map(([k, v]) => [k.toUpperCase(), v]),
    );
    expect(qqChannel.webhook.verify(adapter, { rawBody: RAW, headers })).toBe(true);
    expect(qqChannel.webhook.verify(adapter, { rawBody: `${RAW} `, headers })).toBe(false);
    expect(await qqChannel.webhook.ingest(adapter, JSON.parse(RAW))).toBe("delivered");
    expect(await qqChannel.webhook.ingest(adapter, [1])).toBe("malformed");
    expect(delivered).toHaveLength(1);
  });

  it("rejects a bad or missing signature with 401 and dispatches nothing", async () => {
    const { handler, delivered } = setup(true);
    const bad = { ...signed(), "x-signature-ed25519": "00".repeat(64) };
    expect((await handler(post(RAW, bad))).status).toBe(401);
    expect((await handler(post(RAW, {}))).status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 503 when no handler is subscribed", async () => {
    expect((await setup(false).handler(post(RAW, signed()))).status).toBe(503);
  });

  it("answers 400 for a body that is not JSON", async () => {
    expect((await setup(true).handler(post("nope", signed("nope")))).status).toBe(400);
  });

  it("answers the unsigned callback URL validation with the signed token as JSON", async () => {
    const raw = JSON.stringify({ op: 13, d: { plain_token: "tok123", event_ts: "1700000000" } });
    const res = await setup(true).handler(post(raw, {}));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      plain_token: "tok123",
      signature: signQQ(CONFIG.appSecret, "1700000000tok123"),
    });
  });

  it("answers 405 for a GET", async () => {
    const res = await setup(true).handler(new Request("https://example.test/webhooks/qq"));
    expect(res.status).toBe(405);
  });
});

describe("malformed signed payloads", () => {
  it("answers a null d without throwing", async () => {
    const { adapter } = setup(true);
    expect(await adapter.ingestPayload({ op: 0, t: "C2C_MESSAGE_CREATE", d: null })).toBe(
      "delivered",
    );
  });
});
