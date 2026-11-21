import { configFromEnv, createChannels, createWebhookHandler } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { describeWebhookChannel, webhookRoute } from "../../../shared/webhook-channel-cases.js";

import { QQAdapter } from "../src/adapter.js";
import { qqChannel } from "../src/channel.js";
import { ConfigurationError } from "../src/errors.js";
import { signQQ } from "../src/signature.js";

const SECRET = "qq-secret";
const CONFIG = { appId: "app1", appSecret: SECRET };

const TEXT = {
  op: 0,
  t: "C2C_MESSAGE_CREATE",
  d: {
    id: "m1",
    content: " hi ",
    author: { user_openid: "u1" },
    timestamp: "2024-01-01T00:00:00Z",
  },
};

function signed(event: object): { rawBody: string; headers: Record<string, string> } {
  const rawBody = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    rawBody,
    headers: { "X-Signature-Ed25519": signQQ(SECRET, ts + rawBody), "X-Signature-Timestamp": ts },
  };
}

describe("qqChannel descriptor", () => {
  it("declares a webhook transport and its config", () => {
    expect(qqChannel.transport).toBe("webhook");
    expect(qqChannel.platform).toBe("qq");
    expect(qqChannel.config.map((f) => f.key)).toEqual([
      "appId",
      "appSecret",
      "apiBase",
      "tokenUrl",
    ]);
  });

  it("creates an adapter, and refuses a non-string or empty field", () => {
    expect(qqChannel.create(CONFIG)).toBeInstanceOf(QQAdapter);
    expect(() => qqChannel.create({ ...CONFIG, appId: 1 })).toThrow(/config\.appId/);
    expect(() => qqChannel.create({ ...CONFIG, appSecret: "" })).toThrow(/appSecret/);
  });
});

describe("qqChannel.webhook", () => {
  it("verifies a signed request, with any header case", () => {
    const adapter = qqChannel.create(CONFIG);
    const { rawBody, headers } = signed(TEXT);
    expect(qqChannel.webhook.verify(adapter, { rawBody, headers })).toBe(true);
    const lower = {
      "x-signature-ed25519": headers["X-Signature-Ed25519"],
      "x-signature-timestamp": headers["X-Signature-Timestamp"],
    };
    expect(qqChannel.webhook.verify(adapter, { rawBody, headers: lower })).toBe(true);
  });

  it("rejects a missing or wrong signature", () => {
    const adapter = qqChannel.create(CONFIG);
    const { rawBody, headers } = signed(TEXT);
    expect(qqChannel.webhook.verify(adapter, { rawBody, headers: {} })).toBe(false);
    const bad = { ...headers, "X-Signature-Ed25519": "00" };
    expect(qqChannel.webhook.verify(adapter, { rawBody, headers: bad })).toBe(false);
  });

  it("ingests a C2C text event, skips others, and reports malformed and no_handler", async () => {
    const adapter = qqChannel.create(CONFIG);
    expect(await qqChannel.webhook.ingest(adapter, TEXT)).toBe("no_handler");
    const texts: string[] = [];
    adapter.onInbound(async (e) => void texts.push(e.text ?? ""));
    expect(await qqChannel.webhook.ingest(adapter, TEXT)).toBe("delivered");
    expect(texts).toEqual(["hi"]);
    expect(await qqChannel.webhook.ingest(adapter, { op: 0, t: "OTHER" })).toBe("delivered");
    expect(await qqChannel.webhook.ingest(adapter, null)).toBe("malformed");
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
  platform: "qq",
  descriptor: qqChannel,
  config: CONFIG,
  signedText: () => signed(TEXT),
  badSignature: ({ headers }: { headers: Record<string, string> }) => ({
    ...headers,
    "x-signature-ed25519": "00",
  }),
  bindings: [
    ["appId", "QQ_APP_ID"],
    ["appSecret", "QQ_APP_SECRET"],
    ["apiBase", "QQ_API_BASE"],
    ["tokenUrl", "QQ_TOKEN_URL"],
  ],
  required: ["appId", "appSecret"],
  secrets: ["appSecret"],
  adapterClass: QQAdapter,
  errorClass: ConfigurationError,
} as const;

describeWebhookChannel(TOOLS, SPEC);

describe("qq webhook callback URL validation", () => {
  it("answers the unsigned callback URL validation with the signed plain_token", async () => {
    const { handler } = webhookRoute(TOOLS, SPEC);
    const body = JSON.stringify({ op: 13, d: { plain_token: "tok123", event_ts: "1700000000" } });
    const res = await handler(
      new Request("https://bot.test/webhooks/qq", { method: "POST", body }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      plain_token: "tok123",
      signature: signQQ(SECRET, "1700000000tok123"),
    });
  });
});
