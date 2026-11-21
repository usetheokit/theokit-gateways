import {
  configFromEnv,
  type ChannelDescriptor,
  createChannels,
  createWebhookHandler,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { ZaloAdapter } from "../src/adapter.js";
import { ConfigurationError } from "../src/errors.js";
import { zaloChannel } from "../src/channel.js";
import { computeZaloSignature } from "../src/signature.js";

const APP = "app1";
const SECRET = "oa-secret";
const CONFIG = { appId: APP, oaSecretKey: SECRET, accessToken: "tok" };

const TEXT = {
  app_id: APP,
  event_name: "user_send_text",
  sender: { id: "u1" },
  recipient: { id: "oa1" },
  message: { text: "hi", msg_id: "m1" },
  timestamp: "1700000000000",
};

function signed(event: object): { rawBody: string; headers: Record<string, string> } {
  const rawBody = JSON.stringify(event);
  const ts = String((event as { timestamp: string }).timestamp);
  return {
    rawBody,
    headers: { "X-ZEvent-Signature": `mac=${computeZaloSignature(APP, rawBody, ts, SECRET)}` },
  };
}

describe("zaloChannel descriptor", () => {
  it("declares a webhook transport and its config", () => {
    expect(zaloChannel.transport).toBe("webhook");
    expect(zaloChannel.platform).toBe("zalo");
    expect(zaloChannel.config.map((f) => f.key)).toEqual([
      "appId",
      "oaSecretKey",
      "accessToken",
      "apiBase",
    ]);
  });

  it("creates an adapter, and refuses a non-string or empty field", () => {
    expect(zaloChannel.create(CONFIG)).toBeInstanceOf(ZaloAdapter);
    expect(() => zaloChannel.create({ ...CONFIG, appId: 1 })).toThrow(/config\.appId/);
    expect(() => zaloChannel.create({ ...CONFIG, oaSecretKey: "" })).toThrow(/oaSecretKey/);
  });
});

describe("zaloChannel.webhook", () => {
  it("verifies a signed request, with any header case", () => {
    const adapter = zaloChannel.create(CONFIG);
    const { rawBody, headers } = signed(TEXT);
    expect(zaloChannel.webhook.verify(adapter, { rawBody, headers })).toBe(true);
    const lower = { "x-zevent-signature": headers["X-ZEvent-Signature"] };
    expect(zaloChannel.webhook.verify(adapter, { rawBody, headers: lower })).toBe(true);
  });

  it("rejects a missing or wrong signature", () => {
    const adapter = zaloChannel.create(CONFIG);
    const { rawBody } = signed(TEXT);
    expect(zaloChannel.webhook.verify(adapter, { rawBody, headers: {} })).toBe(false);
    const bad = { "X-ZEvent-Signature": "mac=00" };
    expect(zaloChannel.webhook.verify(adapter, { rawBody, headers: bad })).toBe(false);
  });

  it("ingests a text event, skips others, and reports malformed and no_handler", async () => {
    const adapter = zaloChannel.create(CONFIG);
    expect(await zaloChannel.webhook.ingest(adapter, TEXT)).toBe("no_handler");
    const texts: string[] = [];
    adapter.onInbound(async (e) => void texts.push(e.text ?? ""));
    expect(await zaloChannel.webhook.ingest(adapter, TEXT)).toBe("delivered");
    expect(texts).toEqual(["hi"]);
    expect(await zaloChannel.webhook.ingest(adapter, { ...TEXT, event_name: "follow" })).toBe(
      "delivered",
    );
    expect(await zaloChannel.webhook.ingest(adapter, null)).toBe("malformed");
    expect(await zaloChannel.webhook.ingest(adapter, [])).toBe("malformed");
  });
});

function setup(subscribe: boolean) {
  const result = createChannels([
    { descriptor: zaloChannel as unknown as ChannelDescriptor, config: CONFIG },
  ]);
  const adapter = result.adapters[0] as unknown as ZaloAdapter;
  const delivered: string[] = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e.text ?? ""));
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered };
}

const post = (rawBody: string, headers: Record<string, string>) =>
  new Request("https://bot.test/webhooks/zalo", { method: "POST", body: rawBody, headers });

describe("zalo webhook through createWebhookHandler", () => {
  it("delivers a signed event and answers 200", async () => {
    const { handler, delivered } = setup(true);
    const { rawBody, headers } = signed(TEXT);
    expect((await handler(post(rawBody, headers))).status).toBe(200);
    expect(delivered).toEqual(["hi"]);
  });

  it("answers 401 for a bad signature and delivers nothing", async () => {
    const { handler, delivered } = setup(true);
    const { rawBody } = signed(TEXT);
    const res = await handler(post(rawBody, { "x-zevent-signature": "mac=bad" }));
    expect(res.status).toBe(401);
    expect(delivered).toEqual([]);
  });

  it("answers 503 when no handler is subscribed", async () => {
    const { handler } = setup(false);
    const { rawBody, headers } = signed(TEXT);
    expect((await handler(post(rawBody, headers))).status).toBe(503);
  });

  it("refuses a method the route does not take", async () => {
    const { handler } = setup(true);
    const res = await handler(new Request("https://bot.test/webhooks/zalo"));
    expect(res.status).toBe(405);
  });
});

describe("zaloChannel env bindings", () => {
  const ENV = {
    APP_ZALO_APP_ID: "v-appId",
    APP_ZALO_OA_SECRET_KEY: "v-oaSecretKey",
    APP_ZALO_ACCESS_TOKEN: "v-accessToken",
  };

  it("binds each field to ZALO_<KEY>", () => {
    expect(zaloChannel.config.map((f) => [f.key, f.env])).toEqual([
      ["appId", "ZALO_APP_ID"],
      ["oaSecretKey", "ZALO_OA_SECRET_KEY"],
      ["accessToken", "ZALO_ACCESS_TOKEN"],
      ["apiBase", "ZALO_API_BASE"],
    ]);
  });

  it("builds the adapter from configFromEnv", () => {
    const { config, missing } = configFromEnv(zaloChannel as ChannelDescriptor, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: zaloChannel as ChannelDescriptor, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(ZaloAdapter);
  });

  it.each([
    ["appId", "APP_ZALO_APP_ID"],
    ["oaSecretKey", "APP_ZALO_OA_SECRET_KEY"],
    ["accessToken", "APP_ZALO_ACCESS_TOKEN"],
  ])("rejects with missing_required_config naming %s when %s is unset", (key, variable) => {
    const env: Record<string, string> = { ...ENV };
    delete env[variable];
    const { config, missing } = configFromEnv(zaloChannel as ChannelDescriptor, env, "APP_");
    expect(missing).toEqual([variable]);
    const result = createChannels([
      { descriptor: zaloChannel as ChannelDescriptor, config, envPrefix: "APP_" },
    ]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain(key);
  });

  it("collects only secret values", () => {
    const env = { ...ENV, APP_ZALO_API_BASE: "https://example.test" };
    expect(
      [...configFromEnv(zaloChannel as ChannelDescriptor, env, "APP_").secrets].sort(),
    ).toEqual(["v-accessToken", "v-oaSecretKey"]);
  });

  it("accepts optional string endpoints", () => {
    expect(
      zaloChannel.create({
        ...Object.fromEntries([
          ["appId", "x"],
          ["oaSecretKey", "x"],
          ["accessToken", "x"],
        ]),
        apiBase: "https://example.test",
      }),
    ).toBeInstanceOf(ZaloAdapter);
  });

  it.each(["appId", "oaSecretKey", "accessToken", "apiBase"])(
    "throws invalid_config naming %s for a number",
    (key) => {
      const config = {
        ...Object.fromEntries([
          ["appId", "x"],
          ["oaSecretKey", "x"],
          ["accessToken", "x"],
        ]),
        [key]: 5,
      };
      try {
        zaloChannel.create(config);
        throw new Error("expected a throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        expect((err as ConfigurationError).code).toBe("invalid_config");
        expect((err as ConfigurationError).message).toContain(key);
      }
    },
  );
});
