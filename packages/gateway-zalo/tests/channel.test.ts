import {
  type BasePlatformAdapter,
  type ChannelDescriptor,
  configFromEnv,
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

describe("zaloChannel over a Fetch request", () => {
  const route = () => {
    const built = createChannels([
      {
        descriptor: zaloChannel as unknown as ChannelDescriptor<BasePlatformAdapter>,
        config: CONFIG,
      },
    ]);
    const handler = createWebhookHandler({ channels: built.channels, isStarted: () => true });
    const send = (headers: Record<string, string> = {}) =>
      handler(
        new Request("https://example.test/webhooks/zalo", {
          method: "POST",
          body: JSON.stringify(payload),
          headers,
        }),
      );
    return { adapter: built.adapters[0], send };
  };
  const good = () => signedRequest(JSON.stringify(payload)).headers as Record<string, string>;

  it("answers 401 to a bad signature, 503 with no handler, and 200 once dispatched", async () => {
    const { adapter, send } = route();
    expect((await send()).status).toBe(401);
    expect((await send(good())).status).toBe(503);
    const seen: MessageEvent[] = [];
    adapter?.onInbound(async (e) => void seen.push(e));
    expect((await send(good())).status).toBe(200);
    expect(seen.map((e) => e.text)).toEqual(["hi"]);
  });
});

describe("zaloChannel environment binding", () => {
  it("reads every credential from its environment variable", () => {
    const { config } = configFromEnv(zaloChannel as unknown as ChannelDescriptor, {
      ZALO_APP_ID: "v-appId",
      ZALO_OA_SECRET_KEY: "v-oaSecretKey",
      ZALO_ACCESS_TOKEN: "v-accessToken",
    });
    expect(config).toEqual({
      appId: "v-appId",
      oaSecretKey: "v-oaSecretKey",
      accessToken: "v-accessToken",
    });
    expect(() => zaloChannel.create(config)).not.toThrow();
  });
});
