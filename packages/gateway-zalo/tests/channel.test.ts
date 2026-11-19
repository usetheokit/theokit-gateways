import { type ChannelDescriptor, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { ZaloAdapter } from "../src/adapter.js";
import { zaloChannel } from "../src/channel.js";
import { computeZaloSignature } from "../src/signature.js";

const CONFIG = { appId: "app1", oaSecretKey: "sec", accessToken: "tok" };
const RAW = JSON.stringify({
  event_name: "user_send_text",
  app_id: "app1",
  timestamp: "1700000000000",
  sender: { id: "u1" },
  recipient: { id: "oa1" },
  message: { msg_id: "m1", text: "hi" },
});
const NOT_JSON = "not json";
const SIGNED = (raw = RAW) => {
  let timestamp = "1";
  try {
    timestamp = String((JSON.parse(raw) as { timestamp: string }).timestamp);
  } catch {}
  return { "x-zevent-signature": `mac=${computeZaloSignature("app1", raw, timestamp, "sec")}` };
};
const BAD = () => ({ "x-zevent-signature": `mac=${"0".repeat(64)}` });
const UPPER = (h: Record<string, string>) =>
  Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toUpperCase(), v]));

function setup(subscribe: boolean) {
  const result = createChannels([
    { descriptor: zaloChannel as unknown as ChannelDescriptor, config: CONFIG },
  ]);
  const adapter = result.adapters[0] as unknown as ZaloAdapter;
  const delivered: unknown[] = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e));
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered, adapter, result };
}

const post = (raw: string, headers: Record<string, string>): Request =>
  new Request("https://example.test/webhooks/zalo", { method: "POST", headers, body: raw });

describe("zaloChannel", () => {
  it("declares webhook transport, POST only, and its config fields", () => {
    expect(zaloChannel.transport).toBe("webhook");
    expect(zaloChannel.webhook.methods).toEqual(["POST"]);
    expect(zaloChannel.config.map((f) => f.key)).toEqual(["appId", "oaSecretKey", "accessToken"]);
    expect(zaloChannel.config.filter((f) => f.secret).map((f) => f.key)).toEqual([
      "oaSecretKey",
      "accessToken",
    ]);
  });

  it("builds the adapter and refuses a missing value", () => {
    expect(setup(false).result.rejected).toEqual([]);
    expect(setup(false).adapter).toBeInstanceOf(ZaloAdapter);
    expect(() => zaloChannel.create({ ...CONFIG, appId: 5 })).toThrow(/appId/);
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
    expect(zaloChannel.webhook.verify(adapter, request)).toBe(true);
    expect(
      zaloChannel.webhook.verify(adapter, { rawBody: RAW + " ", headers: request.headers }),
    ).toBe(false);
    expect(await zaloChannel.webhook.ingest(adapter, JSON.parse(RAW))).toBe("delivered");
    expect(await zaloChannel.webhook.ingest(adapter, [1])).toBe("malformed");
    expect(await zaloChannel.webhook.ingest(adapter, "x")).toBe("malformed");
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

  it("answers 401 for a body that is not JSON, which no signature can cover", async () => {
    const { handler } = setup(true);
    expect((await handler(post(NOT_JSON, SIGNED(NOT_JSON)))).status).toBe(401);
  });

  it("answers 405 for a GET", async () => {
    const res = await setup(true).handler(new Request("https://example.test/webhooks/zalo"));
    expect(res.status).toBe(405);
  });
});
