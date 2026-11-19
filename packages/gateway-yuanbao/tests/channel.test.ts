import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { YuanbaoAdapter } from "../src/adapter.js";
import { yuanbaoChannel } from "../src/channel.js";
import { computeYuanbaoSignature } from "../src/signature.js";

const CONFIG = { appId: "a", appSecret: "s", callbackSecret: "cb" };
const RAW = JSON.stringify({
  type: "message",
  message: { id: "m1", text: "hi", create_time: 1700000000, from: { id: "u1" } },
});
const NOT_JSON = "not json";
const SIGNED = (raw = RAW) => {
  const ts = String(Math.floor(Date.now() / 1000));
  return { "x-signature": computeYuanbaoSignature("cb", ts, raw), "x-timestamp": ts };
};
const BAD = () => ({ ...SIGNED(), "x-signature": "0".repeat(64) });
const UPPER = (h: Record<string, string>) =>
  Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toUpperCase(), v]));

function setup(subscribe: boolean) {
  const result = createChannels([
    { descriptor: yuanbaoChannel as unknown as ChannelDescriptor, config: CONFIG },
  ]);
  const adapter = result.adapters[0] as unknown as YuanbaoAdapter;
  const delivered: unknown[] = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e));
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered, adapter, result };
}

const post = (raw: string, headers: Record<string, string>): Request =>
  new Request("https://example.test/webhooks/yuanbao", { method: "POST", headers, body: raw });

describe("yuanbaoChannel", () => {
  it("declares webhook transport, POST only, and its config fields", () => {
    expect(yuanbaoChannel.transport).toBe("webhook");
    expect(yuanbaoChannel.webhook.methods).toEqual(["POST"]);
    expect(yuanbaoChannel.config.map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
      "callbackSecret",
    ]);
    expect(yuanbaoChannel.config.filter((f) => f.secret).map((f) => f.key)).toEqual([
      "appSecret",
      "callbackSecret",
    ]);
  });

  it("builds the adapter and refuses a missing value", () => {
    expect(setup(false).result.rejected).toEqual([]);
    expect(setup(false).adapter).toBeInstanceOf(YuanbaoAdapter);
    expect(() => yuanbaoChannel.create({ ...CONFIG, appId: 5 })).toThrow(/appId/);
  });

  it("verifies a valid signed request and dispatches it", async () => {
    const { handler, delivered } = setup(true);
    const res = await handler(post(RAW, SIGNED()));
    expect(res.status).toBe(200);
    expect(delivered).toHaveLength(1);
  });

  it("verify and ingest work directly on the descriptor", async () => {
    const { adapter, delivered } = setup(true);
    const request = { rawBody: RAW, headers: UPPER(SIGNED()) };
    expect(yuanbaoChannel.webhook.verify(adapter, request)).toBe(true);
    expect(
      yuanbaoChannel.webhook.verify(adapter, { rawBody: RAW + " ", headers: request.headers }),
    ).toBe(false);
    expect(await yuanbaoChannel.webhook.ingest(adapter, JSON.parse(RAW))).toBe("delivered");
    expect(await yuanbaoChannel.webhook.ingest(adapter, [1])).toBe("malformed");
    expect(await yuanbaoChannel.webhook.ingest(adapter, "x")).toBe("malformed");
    expect(delivered).toHaveLength(1);
  });

  it("rejects a bad or missing signature with 401 and dispatches nothing", async () => {
    const { handler, delivered } = setup(true);
    expect((await handler(post(RAW, BAD()))).status).toBe(401);
    expect((await handler(post(RAW, {}))).status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 503 when no handler is subscribed, then accepts the redelivery", async () => {
    const { handler, adapter } = setup(false);
    expect((await handler(post(RAW, SIGNED()))).status).toBe(503);
    const delivered: unknown[] = [];
    (adapter as unknown as { onInbound(h: (e: unknown) => Promise<void>): void }).onInbound(
      async (e) => void delivered.push(e),
    );
    expect((await handler(post(RAW, SIGNED()))).status).toBe(200);
    expect(delivered).toHaveLength(1);
  });

  it("answers 400 for a signed body that is not JSON", async () => {
    const { handler } = setup(true);
    expect((await handler(post(NOT_JSON, SIGNED(NOT_JSON)))).status).toBe(400);
  });

  it("answers 405 for a GET", async () => {
    const res = await setup(true).handler(new Request("https://example.test/webhooks/yuanbao"));
    expect(res.status).toBe(405);
  });
});
