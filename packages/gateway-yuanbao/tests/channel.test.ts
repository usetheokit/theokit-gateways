import {
  configFromEnv,
  type ChannelDescriptor,
  createChannels,
  createWebhookHandler,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { YuanbaoAdapter } from "../src/adapter.js";
import { ConfigurationError } from "../src/errors.js";
import { yuanbaoChannel } from "../src/channel.js";
import { computeYuanbaoSignature } from "../src/signature.js";

const CALLBACK = "cb-secret";
const CONFIG = { appId: "app1", appSecret: "sec", callbackSecret: CALLBACK };

const TEXT = {
  type: "message",
  message: { id: "m1", text: "hi", from: { id: "u1" }, create_time: 1700000000 },
};

function signed(event: object): { rawBody: string; headers: Record<string, string> } {
  const rawBody = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    rawBody,
    headers: {
      "X-Signature": computeYuanbaoSignature(CALLBACK, ts, rawBody),
      "X-Timestamp": ts,
    },
  };
}

describe("yuanbaoChannel descriptor", () => {
  it("declares a webhook transport and its config", () => {
    expect(yuanbaoChannel.transport).toBe("webhook");
    expect(yuanbaoChannel.platform).toBe("yuanbao");
    expect(yuanbaoChannel.config.map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
      "callbackSecret",
      "apiBase",
    ]);
  });

  it("creates an adapter, and refuses a non-string or empty field", () => {
    expect(yuanbaoChannel.create(CONFIG)).toBeInstanceOf(YuanbaoAdapter);
    expect(() => yuanbaoChannel.create({ ...CONFIG, appId: 1 })).toThrow(/config\.appId/);
    expect(() => yuanbaoChannel.create({ ...CONFIG, callbackSecret: "" })).toThrow(
      /callbackSecret/,
    );
  });
});

describe("yuanbaoChannel.webhook", () => {
  it("verifies a signed request, with any header case", () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    const { rawBody, headers } = signed(TEXT);
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody, headers })).toBe(true);
    const lower = { "x-signature": headers["X-Signature"], "x-timestamp": headers["X-Timestamp"] };
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody, headers: lower })).toBe(true);
  });

  it("rejects a missing or wrong signature", () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    const { rawBody, headers } = signed(TEXT);
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody, headers: {} })).toBe(false);
    const bad = { "X-Signature": "00", "X-Timestamp": headers["X-Timestamp"] };
    expect(yuanbaoChannel.webhook.verify(adapter, { rawBody, headers: bad })).toBe(false);
  });

  it("ingests a text event, skips others, and reports malformed and no_handler", async () => {
    const adapter = yuanbaoChannel.create(CONFIG);
    expect(await yuanbaoChannel.webhook.ingest(adapter, TEXT)).toBe("no_handler");
    const texts: string[] = [];
    adapter.onInbound(async (e) => void texts.push(e.text ?? ""));
    expect(await yuanbaoChannel.webhook.ingest(adapter, TEXT)).toBe("delivered");
    expect(texts).toEqual(["hi"]);
    expect(await yuanbaoChannel.webhook.ingest(adapter, { type: "other" })).toBe("delivered");
    expect(await yuanbaoChannel.webhook.ingest(adapter, null)).toBe("malformed");
    expect(await yuanbaoChannel.webhook.ingest(adapter, [])).toBe("malformed");
  });
});

function setup(subscribe: boolean) {
  const result = createChannels([
    { descriptor: yuanbaoChannel as unknown as ChannelDescriptor, config: CONFIG },
  ]);
  const adapter = result.adapters[0] as unknown as YuanbaoAdapter;
  const delivered: string[] = [];
  if (subscribe) adapter.onInbound(async (e) => void delivered.push(e.text ?? ""));
  const handler = createWebhookHandler({ channels: result.channels, isStarted: () => true });
  return { handler, delivered };
}

const post = (rawBody: string, headers: Record<string, string>) =>
  new Request("https://bot.test/webhooks/yuanbao", { method: "POST", body: rawBody, headers });

describe("yuanbao webhook through createWebhookHandler", () => {
  it("delivers a signed event and answers 200", async () => {
    const { handler, delivered } = setup(true);
    const { rawBody, headers } = signed(TEXT);
    expect((await handler(post(rawBody, headers))).status).toBe(200);
    expect(delivered).toEqual(["hi"]);
  });

  it("answers 401 for a bad signature and delivers nothing", async () => {
    const { handler, delivered } = setup(true);
    const { rawBody } = signed(TEXT);
    const res = await handler(post(rawBody, { "x-signature": "bad", "x-timestamp": "1" }));
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
    const res = await handler(new Request("https://bot.test/webhooks/yuanbao"));
    expect(res.status).toBe(405);
  });
});

describe("yuanbaoChannel env bindings", () => {
  const ENV = {
    APP_YUANBAO_APP_ID: "v-appId",
    APP_YUANBAO_APP_SECRET: "v-appSecret",
    APP_YUANBAO_CALLBACK_SECRET: "v-callbackSecret",
  };

  it("binds each field to YUANBAO_<KEY>", () => {
    expect(yuanbaoChannel.config.map((f) => [f.key, f.env])).toEqual([
      ["appId", "YUANBAO_APP_ID"],
      ["appSecret", "YUANBAO_APP_SECRET"],
      ["callbackSecret", "YUANBAO_CALLBACK_SECRET"],
      ["apiBase", "YUANBAO_API_BASE"],
    ]);
  });

  it("builds the adapter from configFromEnv", () => {
    const { config, missing } = configFromEnv(yuanbaoChannel as ChannelDescriptor, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: yuanbaoChannel as ChannelDescriptor, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(YuanbaoAdapter);
  });

  it.each([
    ["appId", "APP_YUANBAO_APP_ID"],
    ["appSecret", "APP_YUANBAO_APP_SECRET"],
    ["callbackSecret", "APP_YUANBAO_CALLBACK_SECRET"],
  ])("rejects with missing_required_config naming %s when %s is unset", (key, variable) => {
    const env: Record<string, string> = { ...ENV };
    delete env[variable];
    const { config, missing } = configFromEnv(yuanbaoChannel as ChannelDescriptor, env, "APP_");
    expect(missing).toEqual([variable]);
    const result = createChannels([
      { descriptor: yuanbaoChannel as ChannelDescriptor, config, envPrefix: "APP_" },
    ]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain(key);
  });

  it("collects only secret values", () => {
    const env = { ...ENV, APP_YUANBAO_API_BASE: "https://example.test" };
    expect(
      [...configFromEnv(yuanbaoChannel as ChannelDescriptor, env, "APP_").secrets].sort(),
    ).toEqual(["v-appSecret", "v-callbackSecret"]);
  });

  it("accepts optional string endpoints", () => {
    expect(
      yuanbaoChannel.create({
        ...Object.fromEntries([
          ["appId", "x"],
          ["appSecret", "x"],
          ["callbackSecret", "x"],
        ]),
        apiBase: "https://example.test",
      }),
    ).toBeInstanceOf(YuanbaoAdapter);
  });

  it.each(["appId", "appSecret", "callbackSecret", "apiBase"])(
    "throws invalid_config naming %s for a number",
    (key) => {
      const config = {
        ...Object.fromEntries([
          ["appId", "x"],
          ["appSecret", "x"],
          ["callbackSecret", "x"],
        ]),
        [key]: 5,
      };
      try {
        yuanbaoChannel.create(config);
        throw new Error("expected a throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        expect((err as ConfigurationError).code).toBe("invalid_config");
        expect((err as ConfigurationError).message).toContain(key);
      }
    },
  );
});
