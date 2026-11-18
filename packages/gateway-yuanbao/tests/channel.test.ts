import {
  type BasePlatformAdapter,
  type ChannelDescriptor,
  configFromEnv,
  createChannels,
  createWebhookHandler,
  type MessageEvent,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { yuanbaoChannel } from "../src/channel.js";
import { computeYuanbaoSignature } from "../src/index.js";

const CONFIG = { appId: "a", appSecret: "s", callbackSecret: "cb" };
const payload = {
  type: "message",
  message: { id: "m1", from: { id: "u1" }, text: "hi", create_time: 1 },
};

function signedRequest(raw: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    rawBody: raw,
    headers: { "X-Signature": computeYuanbaoSignature("cb", ts, raw), "x-timestamp": ts },
  };
}

describe("yuanbaoChannel", () => {
  it("is a webhook channel with the credentials as config", () => {
    expect(yuanbaoChannel.transport).toBe("webhook");
    expect(yuanbaoChannel.config.map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
      "callbackSecret",
    ]);
    expect(() => yuanbaoChannel.create({ ...CONFIG, appId: 1 })).toThrow(/config.appId/);
  });

  it("verifies a signed request and rejects a tampered or unsigned one", () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    const req = signedRequest(JSON.stringify(payload));
    expect(yuanbaoChannel.webhook.verify(adapter, req)).toBe(true);
    expect(yuanbaoChannel.webhook.verify(adapter, { ...req, rawBody: "{}" })).toBe(false);
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody: req.rawBody, headers: {} })).toBe(
      false,
    );
  });

  it("dispatches a text message, reports malformed and no_handler", async () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    expect(await yuanbaoChannel.webhook.ingest(adapter, payload)).toBe("no_handler");
    const seen: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e);
    });
    expect(await yuanbaoChannel.webhook.ingest(adapter, payload)).toBe("delivered");
    expect(seen.map((e) => e.text)).toEqual(["hi"]);
    expect(await yuanbaoChannel.webhook.ingest(adapter, { type: "other" })).toBe("delivered");
    expect(await yuanbaoChannel.webhook.ingest(adapter, "x")).toBe("malformed");
    expect(await yuanbaoChannel.webhook.ingest(adapter, [])).toBe("malformed");
    const nullNested = { type: "message", message: null };
    expect(await yuanbaoChannel.webhook.ingest(adapter, nullNested)).toBe("malformed");
    expect(seen).toHaveLength(1);
  });

  it("acknowledges an unsupported event whose nested data is null", async () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    expect(await yuanbaoChannel.webhook.ingest(adapter, { type: "other", message: null })).toBe(
      "delivered",
    );
  });
});

describe("yuanbaoChannel over a Fetch request", () => {
  const route = () => {
    const built = createChannels([
      {
        descriptor: yuanbaoChannel as unknown as ChannelDescriptor<BasePlatformAdapter>,
        config: CONFIG,
      },
    ]);
    const handler = createWebhookHandler({ channels: built.channels, isStarted: () => true });
    const send = (headers: Record<string, string> = {}) =>
      handler(
        new Request("https://example.test/webhooks/yuanbao", {
          method: "POST",
          body: JSON.stringify(payload),
          headers,
        }),
      );
    return { adapter: built.adapters[0], send };
  };
  const good = () => signedRequest(JSON.stringify(payload)).headers as Record<string, string>;

  it("rejects a bad signature with 401 before any dispatch", async () => {
    const { adapter, send } = route();
    const seen: MessageEvent[] = [];
    adapter?.onInbound(async (e) => void seen.push(e));
    expect((await send()).status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("dispatches a signed request with 200", async () => {
    const { adapter, send } = route();
    const seen: MessageEvent[] = [];
    adapter?.onInbound(async (e) => void seen.push(e));
    expect((await send(good())).status).toBe(200);
    expect(seen.map((e) => e.text)).toEqual(["hi"]);
  });

  it("answers a signed request with no handler subscribed with 503", async () => {
    const { send } = route();
    expect((await send(good())).status).toBe(503);
  });
});

describe("yuanbaoChannel environment binding", () => {
  it("reads every credential from its environment variable", () => {
    const config = configFromEnv(yuanbaoChannel as unknown as ChannelDescriptor, {
      YUANBAO_APP_ID: "v-appId",
      YUANBAO_APP_SECRET: "v-appSecret",
      YUANBAO_CALLBACK_SECRET: "v-callbackSecret",
    });
    expect(config).toEqual({
      appId: "v-appId",
      appSecret: "v-appSecret",
      callbackSecret: "v-callbackSecret",
    });
    expect(() => yuanbaoChannel.create(config)).not.toThrow();
  });
});
