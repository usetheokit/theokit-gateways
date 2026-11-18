import { createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { qqChannel, signQQ } from "../src/index.js";

const SECRET = "secret";

function signed(raw: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  return { "X-Signature-Ed25519": signQQ(SECRET, ts + raw), "x-signature-timestamp": ts };
}

function build() {
  return qqChannel.create({ appId: "a", appSecret: SECRET });
}

const body = (id: string) =>
  JSON.stringify({
    op: 0,
    t: "C2C_MESSAGE_CREATE",
    d: { id, content: "hi", author: { user_openid: "u1" } },
  });

describe("qqChannel", () => {
  it("describes a webhook channel", () => {
    expect(qqChannel.platform).toBe("qq");
    expect(qqChannel.transport).toBe("webhook");
    expect(qqChannel.config.filter((f) => f.required).map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
    ]);
  });

  it("refuses a non-string config value", () => {
    expect(() => qqChannel.create({ ...{ appId: "a", appSecret: SECRET }, appId: 5 })).toThrow(
      /config.appId/,
    );
  });

  it("verifies a signed request and refuses a bad one", () => {
    const adapter = build();
    const raw = body("m1");
    expect(qqChannel.webhook.verify(adapter, { rawBody: raw, headers: signed(raw) })).toBe(true);
    expect(qqChannel.webhook.verify(adapter, { rawBody: raw, headers: {} })).toBe(false);
    expect(qqChannel.webhook.verify(adapter, { rawBody: raw + " ", headers: signed(raw) })).toBe(
      false,
    );
  });

  it("ingests, dedupes and reports malformed and missing handler", async () => {
    const adapter = build();
    expect(await qqChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("no_handler");
    const seen: string[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e.text);
    });
    expect(await qqChannel.webhook.ingest(adapter, "x")).toBe("malformed");
    expect(await qqChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("delivered");
    expect(await qqChannel.webhook.ingest(adapter, JSON.parse(body("m1")))).toBe("delivered");
    expect(await qqChannel.webhook.ingest(adapter, {})).toBe("delivered");
    expect(seen).toEqual(["hi"]);
  });

  it("answers the unsigned callback validation through handle", async () => {
    const adapter = build();
    const raw = JSON.stringify({ op: 13, d: { plain_token: "tok", event_ts: "1700000000" } });
    const answer = await qqChannel.webhook.handle(adapter, { rawBody: raw, headers: {} });
    expect(answer.status).toBe(200);
    expect(answer.contentType).toBe("application/json");
    expect(JSON.parse(answer.body ?? "")).toEqual({
      plain_token: "tok",
      signature: signQQ(SECRET, "1700000000tok"),
    });
  });

  it("handle refuses an unsigned event and dispatches a signed one", async () => {
    const adapter = build();
    const raw = body("m1");
    expect((await qqChannel.webhook.handle(adapter, { rawBody: raw, headers: {} })).status).toBe(
      401,
    );
    expect(
      (await qqChannel.webhook.handle(adapter, { rawBody: raw, headers: signed(raw) })).status,
    ).toBe(503);
  });
});

describe("qqChannel through the core", () => {
  it("rejects a mistyped value without stopping other channels", () => {
    const result = createChannels([
      {
        descriptor: qqChannel as never,
        config: { ...{ appId: "a", appSecret: SECRET }, appId: 5 },
      },
    ]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.error.code).toBe("invalid_config");
    expect(result.rejected[0]?.error.detail).toBe("appId");
  });

  it("routes a Fetch request: signed delivery, bad signature, no handler", async () => {
    const { channels } = createChannels([
      { descriptor: qqChannel as never, config: { appId: "a", appSecret: SECRET } },
    ]);
    const handler = createWebhookHandler({ channels, isStarted: () => true });
    const post = (raw: string, headers: Record<string, string>) =>
      handler(
        new Request("https://example.test/webhooks/qq", {
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
      (await handler(new Request("https://example.test/webhooks/qq", { method: "GET" }))).status,
    ).toBe(405);
  });

  it("answers the QQ callback challenge over Fetch", async () => {
    const { channels } = createChannels([
      { descriptor: qqChannel as never, config: { appId: "a", appSecret: SECRET } },
    ]);
    const handler = createWebhookHandler({ channels, isStarted: () => true });
    const res = await handler(
      new Request("https://example.test/webhooks/qq", {
        method: "POST",
        body: JSON.stringify({ op: 13, d: { plain_token: "tok", event_ts: "1700000000" } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      plain_token: "tok",
      signature: signQQ(SECRET, "1700000000tok"),
    });
  });
});
