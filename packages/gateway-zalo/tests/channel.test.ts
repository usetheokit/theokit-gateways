import { configFromEnv, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { describeWebhookChannel } from "../../../shared/webhook-channel-cases.js";

import { ZaloAdapter } from "../src/adapter.js";
import { zaloChannel } from "../src/channel.js";
import { ConfigurationError } from "../src/errors.js";
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

const TOOLS = {
  describe,
  it,
  expect,
  createChannels,
  createWebhookHandler,
  configFromEnv,
} as never;

const SPEC = {
  platform: "zalo",
  descriptor: zaloChannel,
  config: CONFIG,
  signedText: () => signed(TEXT),
  badSignature: () => ({ "x-zevent-signature": "mac=bad" }),
  bindings: [
    ["appId", "ZALO_APP_ID"],
    ["oaSecretKey", "ZALO_OA_SECRET_KEY"],
    ["accessToken", "ZALO_ACCESS_TOKEN"],
    ["apiBase", "ZALO_API_BASE"],
  ],
  required: ["appId", "oaSecretKey", "accessToken"],
  secrets: ["oaSecretKey", "accessToken"],
  adapterClass: ZaloAdapter,
  errorClass: ConfigurationError,
  refusesGet: true,
} as const;

describeWebhookChannel(TOOLS, SPEC);
