import {
  type BasePlatformAdapter,
  type ChannelDescriptor,
  createChannels,
  createWebhookHandler,
  type MessageEvent,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { zaloChannel } from "../src/channel.js";
import { computeZaloSignature } from "../src/index.js";

const CONFIG = { appId: "app", oaSecretKey: "sec", accessToken: "tok" };
const payload = {
  app_id: "app",
  event_name: "user_send_text",
  timestamp: "1700000000000",
  sender: { id: "u1" },
  recipient: { id: "oa" },
  message: { msg_id: "m1", text: "hi" },
};

function signedRequest(raw: string, ts = "1700000000000") {
  return {
    rawBody: raw,
    headers: { "X-ZEvent-Signature": `mac=${computeZaloSignature("app", raw, ts, "sec")}` },
  };
}

describe("zaloChannel", () => {
  it("is a webhook channel with the credentials as config", () => {
    expect(zaloChannel.transport).toBe("webhook");
    expect(zaloChannel.config.map((f) => f.key)).toEqual(["appId", "oaSecretKey", "accessToken"]);
    expect(() => zaloChannel.create({ ...CONFIG, accessToken: 1 })).toThrow(/config.accessToken/);
  });

  it("verifies a signed request and rejects a tampered or unsigned one", () => {
    const adapter = zaloChannel.create(CONFIG);
    const req = signedRequest(JSON.stringify(payload));
    expect(zaloChannel.webhook.verify(adapter, req)).toBe(true);
    expect(
      zaloChannel.webhook.verify(adapter, {
        ...req,
        rawBody: JSON.stringify({ ...payload, x: 1 }),
      }),
    ).toBe(false);
    expect(zaloChannel.webhook.verify(adapter, { rawBody: req.rawBody, headers: {} })).toBe(false);
  });

  it("dispatches a text message, reports malformed and no_handler", async () => {
    const adapter = zaloChannel.create(CONFIG);
    expect(await zaloChannel.webhook.ingest(adapter, payload)).toBe("no_handler");
    const seen: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e);
    });
    expect(await zaloChannel.webhook.ingest(adapter, payload)).toBe("delivered");
    expect(seen.map((e) => e.text)).toEqual(["hi"]);
    expect(await zaloChannel.webhook.ingest(adapter, { ...payload, event_name: "follow" })).toBe(
      "delivered",
    );
    expect(await zaloChannel.webhook.ingest(adapter, { ...payload, app_id: "other" })).toBe(
      "delivered",
    );
    expect(await zaloChannel.webhook.ingest(adapter, null)).toBe("malformed");
    expect(await zaloChannel.webhook.ingest(adapter, 5)).toBe("malformed");
    expect(seen).toHaveLength(1);
  });
});

describe("zaloChannel through createChannels and createWebhookHandler", () => {
  const descriptor = zaloChannel as unknown as ChannelDescriptor<BasePlatformAdapter>;

  function route(config: Record<string, unknown> = CONFIG) {
    const built = createChannels([{ descriptor, config }]);
    const handler = createWebhookHandler({ channels: built.channels, isStarted: () => true });
    return { built, handler };
  }

  const post = (raw: string, headers: Record<string, string> = {}) =>
    new Request("https://example.test/webhooks/zalo", { method: "POST", body: raw, headers });

  it("reports a wrongly typed credential as a rejected channel instead of throwing", () => {
    const built = createChannels([{ descriptor, config: { ...CONFIG, appId: 1 } }]);
    expect(built.channels).toHaveLength(0);
    expect(built.rejected).toHaveLength(1);
  });

  it("answers a signed request 200, delivering it, and a bad signature 401", async () => {
    const { built, handler } = route();
    const seen: MessageEvent[] = [];
    built.adapters[0]?.onInbound(async (e) => {
      seen.push(e);
    });
    const raw = JSON.stringify(payload);
    const good = signedRequest(raw);
    expect((await handler(post(raw, good.headers as Record<string, string>))).status).toBe(200);
    expect(seen.map((e) => e.text)).toEqual(["hi"]);
    expect((await handler(post(raw))).status).toBe(401);
    expect(seen).toHaveLength(1);
  });

  it("does not acknowledge a signed request while no handler is subscribed", async () => {
    const { handler } = route();
    const raw = JSON.stringify(payload);
    const res = await handler(post(raw, signedRequest(raw).headers as Record<string, string>));
    expect(res.status).not.toBe(200);
  });
});
