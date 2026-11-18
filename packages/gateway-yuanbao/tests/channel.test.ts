import { createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { computeYuanbaoSignature, yuanbaoChannel } from "../src/index.js";

const SECRET = "cb";

const NOW = () => String(Math.floor(Date.now() / 1000));
function signed(raw: string) {
  const ts = NOW();
  return { "X-Signature": computeYuanbaoSignature(SECRET, ts, raw), "x-timestamp": ts };
}

function build() {
  return yuanbaoChannel.create({ appId: "a", appSecret: "s", callbackSecret: SECRET });
}

const body = (id: string) =>
  JSON.stringify({ type: "message", message: { id, text: "hi", from: { id: "u1" } } });

describe("yuanbaoChannel", () => {
  it("describes a webhook channel", () => {
    expect(yuanbaoChannel.platform).toBe("yuanbao");
    expect(yuanbaoChannel.transport).toBe("webhook");
    expect(yuanbaoChannel.config.filter((f) => f.required).map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
      "callbackSecret",
    ]);
  });

  it("refuses a non-string config value", () => {
    expect(() =>
      yuanbaoChannel.create({
        ...{ appId: "a", appSecret: "s", callbackSecret: SECRET },
        appId: 5,
      }),
    ).toThrow(/config.appId/);
  });

  it("verifies a signed request and refuses a bad one", () => {
    const adapter = build();
    const raw = body("m1");
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody: raw, headers: signed(raw) })).toBe(
      true,
    );
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody: raw, headers: {} })).toBe(false);
    expect(
      yuanbaoChannel.webhook.verify(adapter, { rawBody: raw + " ", headers: signed(raw) }),
    ).toBe(false);
  });

  it("ingests, dedupes and reports malformed and missing handler", async () => {
    const adapter = build();
    expect(await yuanbaoChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("no_handler");
    const seen: string[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e.text);
    });
    expect(await yuanbaoChannel.webhook.ingest(adapter, "x")).toBe("malformed");
    expect(await yuanbaoChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("delivered");
    expect(await yuanbaoChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("delivered");
    expect(await yuanbaoChannel.webhook.ingest(adapter, {})).toBe("delivered");
    expect(seen).toEqual(["hi"]);
  });
});

describe("yuanbaoChannel through the core", () => {
  it("rejects a mistyped value without stopping other channels", () => {
    const result = createChannels([
      {
        descriptor: yuanbaoChannel as never,
        config: { ...{ appId: "a", appSecret: "s", callbackSecret: SECRET }, appId: 5 },
      },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.error.code).toBe("invalid_config");
    expect(result.rejected[0]?.error.detail).toBe("appId");
  });

  it("routes a Fetch request: signed delivery, bad signature, no handler", async () => {
    const { channels } = createChannels([
      {
        descriptor: yuanbaoChannel as never,
        config: { appId: "a", appSecret: "s", callbackSecret: SECRET },
      },
    ]);
    const handler = createWebhookHandler({ channels, isStarted: () => true });
    const post = (raw: string, headers: Record<string, string>) =>
      handler(
        new Request("https://example.test/webhooks/yuanbao", {
          method: "POST",
          body: raw,
          headers,
        }),
      );
    const raw = body("m9");
    expect((await post(raw, {})).status).toBe(401);
    expect((await post("not json", signed("not json"))).status).toBe(400);
    expect((await post(raw, signed(raw))).status).toBe(503);
    const seen: string[] = [];
    channels[0]?.adapter.onInbound(async (e) => {
      seen.push(e.id);
    });
    expect((await post(raw, signed(raw))).status).toBe(200);
    expect(seen).toEqual(["m9"]);
    expect(
      (await handler(new Request("https://example.test/webhooks/yuanbao", { method: "GET" })))
        .status,
    ).toBe(405);
  });
});
