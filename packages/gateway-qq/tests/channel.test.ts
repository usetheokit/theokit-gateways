import {
  type BasePlatformAdapter,
  type ChannelDescriptor,
  configFromEnv,
  createChannels,
  createWebhookHandler,
  GatewayConfigurationError,
  type MessageEvent,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { qqChannel } from "../src/channel.js";
import { signQQ } from "../src/index.js";

const CONFIG = { appId: "a", appSecret: "secret" };
const payload = {
  op: 0,
  t: "C2C_MESSAGE_CREATE",
  d: {
    id: "m1",
    content: " hi",
    timestamp: "2026-11-11T10:00:00+08:00",
    author: { user_openid: "u1" },
  },
};

function signedRequest(raw: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    rawBody: raw,
    headers: { "X-Signature-Ed25519": signQQ("secret", ts + raw), "x-signature-timestamp": ts },
  };
}

describe("qqChannel", () => {
  it("is a webhook channel with the credentials as config", () => {
    expect(qqChannel.transport).toBe("webhook");
    expect(qqChannel.config.map((f) => f.key)).toEqual(["appId", "appSecret"]);
    expect(() => qqChannel.create({ ...CONFIG, appId: 1 })).toThrow(/config.appId/);
  });

  it("verifies a signed request and rejects a tampered or unsigned one", () => {
    const adapter = qqChannel.create(CONFIG);
    const req = signedRequest(JSON.stringify(payload));
    expect(qqChannel.webhook.verify(adapter, req)).toBe(true);
    expect(qqChannel.webhook.verify(adapter, { ...req, rawBody: "{}" })).toBe(false);
    expect(qqChannel.webhook.verify(adapter, { rawBody: req.rawBody, headers: {} })).toBe(false);
  });

  it("dispatches a text message, reports malformed and no_handler", async () => {
    const adapter = qqChannel.create(CONFIG);
    expect(await qqChannel.webhook.ingest(adapter, payload)).toBe("no_handler");
    const seen: MessageEvent[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e);
    });
    expect(await qqChannel.webhook.ingest(adapter, payload)).toBe("delivered");
    expect(seen.map((e) => e.text)).toEqual(["hi"]);
    expect(await qqChannel.webhook.ingest(adapter, { op: 11 })).toBe("delivered");
    expect(await qqChannel.webhook.ingest(adapter, null)).toBe("malformed");
    expect(await qqChannel.webhook.ingest(adapter, "x")).toBe("malformed");
    const nullNested = { op: 0, t: "C2C_MESSAGE_CREATE", d: null };
    expect(await qqChannel.webhook.ingest(adapter, nullNested)).toBe("malformed");
    expect(seen).toHaveLength(1);
  });

  it("acknowledges an unsupported event whose nested data is null", async () => {
    const adapter = qqChannel.create(CONFIG);
    expect(await qqChannel.webhook.ingest(adapter, { op: 0, t: "OTHER", d: null })).toBe(
      "delivered",
    );
  });

  it("handle answers the callback URL validation with a signed body", async () => {
    const adapter = qqChannel.create(CONFIG);
    const raw = JSON.stringify({ op: 13, d: { plain_token: "tok", event_ts: "123" } });
    const answer = await qqChannel.webhook.handle(adapter, { rawBody: raw, headers: {} });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body ?? "")).toEqual({
      plain_token: "tok",
      signature: signQQ("secret", "123tok"),
    });
  });

  it("handle answers 401 to an unsigned event and 503 to a signed one with no handler", async () => {
    const adapter = qqChannel.create(CONFIG);
    const raw = JSON.stringify(payload);
    expect((await qqChannel.webhook.handle(adapter, { rawBody: raw, headers: {} })).status).toBe(
      401,
    );
    expect((await qqChannel.webhook.handle(adapter, signedRequest(raw))).status).toBe(503);
  });
});

describe("qqChannel through createChannels and createWebhookHandler", () => {
  const descriptor = qqChannel as unknown as ChannelDescriptor<BasePlatformAdapter>;

  function route(config: Record<string, unknown> = CONFIG) {
    const built = createChannels([{ descriptor, config }]);
    const handler = createWebhookHandler({ channels: built.channels, isStarted: () => true });
    return { built, handler };
  }

  const post = (raw: string, headers: Record<string, string> = {}) =>
    new Request("https://example.test/webhooks/qq", { method: "POST", body: raw, headers });

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

  it("answers the callback URL validation with the signed body", async () => {
    const { handler } = route();
    const raw = JSON.stringify({ op: 13, d: { plain_token: "tok", event_ts: "123" } });
    const res = await handler(post(raw));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plain_token: "tok", signature: signQQ("secret", "123tok") });
  });
});

describe("qqChannel environment binding", () => {
  it("reads every credential from its environment variable", () => {
    const { config } = configFromEnv(qqChannel as unknown as ChannelDescriptor, {
      QQ_APP_ID: "v-appId",
      QQ_APP_SECRET: "v-appSecret",
    });
    expect(config).toEqual({ appId: "v-appId", appSecret: "v-appSecret" });
    expect(() => qqChannel.create(config)).not.toThrow();
  });
});

describe("qqChannel refused configuration", () => {
  it("lands in rejected through createChannels instead of aborting", () => {
    const descriptor = qqChannel as unknown as ChannelDescriptor<BasePlatformAdapter>;
    const bad = { ...CONFIG, appId: 1 };
    const empty = { ...CONFIG, appId: "" };
    for (const config of [bad, empty]) {
      const built = createChannels([{ descriptor, config }]);
      expect(built.adapters).toHaveLength(0);
      expect(built.rejected).toHaveLength(1);
      expect(built.rejected[0]?.error).toBeInstanceOf(GatewayConfigurationError);
    }
  });
});
