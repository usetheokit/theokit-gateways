import { configFromEnv, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { describeWebhookChannel } from "../../../shared/webhook-channel-cases.js";

import { YuanbaoAdapter } from "../src/adapter.js";
import { yuanbaoChannel } from "../src/channel.js";
import { ConfigurationError } from "../src/errors.js";
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

const TOOLS = {
  describe,
  it,
  expect,
  createChannels,
  createWebhookHandler,
  configFromEnv,
} as never;

const SPEC = {
  platform: "yuanbao",
  descriptor: yuanbaoChannel,
  config: CONFIG,
  signedText: () => signed(TEXT),
  badSignature: () => ({ "x-signature": "bad", "x-timestamp": "1" }),
  bindings: [
    ["appId", "YUANBAO_APP_ID"],
    ["appSecret", "YUANBAO_APP_SECRET"],
    ["callbackSecret", "YUANBAO_CALLBACK_SECRET"],
    ["apiBase", "YUANBAO_API_BASE"],
  ],
  required: ["appId", "appSecret", "callbackSecret"],
  secrets: ["appSecret", "callbackSecret"],
  adapterClass: YuanbaoAdapter,
  errorClass: ConfigurationError,
  refusesGet: true,
} as const;

describeWebhookChannel(TOOLS, SPEC);
