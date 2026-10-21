/**
 * `lineChannel` — the LINE channel described as data (FR-005; alignment AC-005).
 *
 * The adapter is built through the descriptor and connected through the real `@line/bot-sdk`,
 * whose HTTP client calls the global `fetch`; the stub answers the two endpoints this file relies
 * on and throws on any other request, so a push where a reply was expected cannot pass silently.
 */

import type { MessageEvent } from "@theokit/gateway";
import { GatewayConfigurationError } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LineAdapter } from "../src/adapter.js";
import { lineChannel } from "../src/channel.js";
import { ConfigurationError } from "../src/errors.js";
import { computeLineSignature } from "../src/signature.js";

const SECRET = "test-channel-secret";
const CONFIG = { channelSecret: SECRET, channelAccessToken: "test-access-token" };
const BOT_INFO = "https://api.line.me/v2/bot/info";
const REPLY = "https://api.line.me/v2/bot/message/reply";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
}

function describeRequest(input: string | URL | Request, init?: RequestInit): Seen {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return { url, method, body: typeof init?.body === "string" ? init.body : undefined };
}

function stubLineApi(): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = describeRequest(input, init);
      seen.push(request);
      const { url, method } = request;
      if (url === BOT_INFO && method === "GET") {
        return new Response(JSON.stringify({ userId: "Ubot", displayName: "bot" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === REPLY && method === "POST") {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected LINE API request: ${method} ${url}`);
    }),
  );
  return seen;
}

function textEvent(text: string, replyToken = "reply-token-1") {
  return {
    type: "message",
    replyToken,
    timestamp: 1,
    source: { type: "user", userId: "U-alice" },
    message: { id: "m-1", type: "text", text },
  };
}

function signed(body: string, header = "x-line-signature") {
  return { rawBody: body, headers: { [header]: computeLineSignature(SECRET, body) } };
}

function configurationErrorOf(fn: () => unknown): ConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err, "threw something that is not a ConfigurationError").toBeInstanceOf(
      ConfigurationError,
    );
    return err as ConfigurationError;
  }
  throw new Error("expected a ConfigurationError, nothing was thrown");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lineChannel.webhook.verify", () => {
  it("refuses a body whose x-line-signature does not match", () => {
    const adapter = lineChannel.create(CONFIG);
    const request = signed('{"events":[]}');
    expect(lineChannel.webhook.verify(adapter, { ...request, rawBody: '{"events":[{}]}' })).toBe(
      false,
    );
  });

  it("accepts a body signed with the adapter's secret", () => {
    const adapter = lineChannel.create(CONFIG);
    expect(lineChannel.webhook.verify(adapter, signed('{"events":[]}'))).toBe(true);
  });

  it("accepts the signature header in any case", () => {
    const adapter = lineChannel.create(CONFIG);
    expect(lineChannel.webhook.verify(adapter, signed('{"events":[]}', "X-Line-Signature"))).toBe(
      true,
    );
  });

  it("refuses a request with no signature header", () => {
    const adapter = lineChannel.create(CONFIG);
    expect(lineChannel.webhook.verify(adapter, { rawBody: "{}", headers: {} })).toBe(false);
  });
});

describe("lineChannel.webhook.ingest", () => {
  it("returns malformed for a body with no events array without calling the handler", async () => {
    const adapter = lineChannel.create(CONFIG);
    const handler = vi.fn(async (_event: MessageEvent) => {});
    adapter.onInbound(handler);

    expect(await lineChannel.webhook.ingest(adapter, { destination: "U" })).toBe("malformed");
    expect(await lineChannel.webhook.ingest(adapter, null)).toBe("malformed");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns malformed for an events array holding a non-object", async () => {
    const adapter = lineChannel.create(CONFIG);
    const handler = vi.fn(async (_event: MessageEvent) => {});
    adapter.onInbound(handler);

    expect(await lineChannel.webhook.ingest(adapter, { events: [null] })).toBe("malformed");
    expect(await lineChannel.webhook.ingest(adapter, { events: [textEvent("hi"), 1] })).toBe(
      "malformed",
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers a text message event to the subscribed handler with its reply token cached", async () => {
    const seen = stubLineApi();
    const adapter = lineChannel.create(CONFIG);
    expect(await adapter.connect()).toBe(true);
    const handler = vi.fn(async (_event: MessageEvent) => {});
    adapter.onInbound(handler);

    expect(await lineChannel.webhook.ingest(adapter, { events: [textEvent("hello")] })).toBe(
      "delivered",
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ platform: "line", text: "hello" });

    const result = await adapter.sendMessage({
      channel: { id: "U-alice", type: "dm" },
      text: "hi",
    });
    expect(result.ok).toBe(true);
    const replies = seen.filter((r) => r.url === REPLY);
    expect(replies).toHaveLength(1);
    expect(JSON.parse(replies[0]?.body ?? "{}")).toMatchObject({ replyToken: "reply-token-1" });
  });

  it("reports delivered for a follow event and calls no handler", async () => {
    const adapter = lineChannel.create(CONFIG);
    const handler = vi.fn(async (_event: MessageEvent) => {});
    adapter.onInbound(handler);

    const follow = { type: "follow", replyToken: "r", source: { type: "user", userId: "U-bob" } };
    expect(await lineChannel.webhook.ingest(adapter, { events: [follow] })).toBe("delivered");
    expect(handler).not.toHaveBeenCalled();
  });

  it("reports no_handler for a text message when no handler is subscribed", async () => {
    const adapter = lineChannel.create(CONFIG);

    expect(await lineChannel.webhook.ingest(adapter, { events: [textEvent("unheard")] })).toBe(
      "no_handler",
    );
  });

  it("reports delivered for an empty events array when no handler is subscribed", async () => {
    const adapter = lineChannel.create(CONFIG);

    expect(await lineChannel.webhook.ingest(adapter, { events: [] })).toBe("delivered");
  });
});

describe("lineChannel", () => {
  it("reports the required and secret fields", () => {
    const byKey = Object.fromEntries(lineChannel.config.map((f) => [f.key, f]));
    expect(byKey.channelSecret).toMatchObject({ required: true, secret: true });
    expect(byKey.channelAccessToken).toMatchObject({ required: true, secret: true });
    expect(byKey.botUserId).toMatchObject({ required: false });
    expect(byKey.requireMention).toMatchObject({ required: false, secret: false });
    expect(lineChannel.platform).toBe("line");
    expect(lineChannel.transport).toBe("webhook");
  });

  it("builds a LineAdapter from a secret and a token", () => {
    expect(lineChannel.create(CONFIG)).toBeInstanceOf(LineAdapter);
  });

  it("refuses a channel secret that is not a string", () => {
    const error = configurationErrorOf(() =>
      lineChannel.create({ channelSecret: 42, channelAccessToken: "t" }),
    );
    expect(error).toBeInstanceOf(GatewayConfigurationError);
    expect(error.code).toBe("invalid_config");
    expect(error.detail).toBe("channelSecret");
    expect(error.message).toContain("channelSecret");
  });

  it("refuses an optional field of the wrong type", () => {
    expect(configurationErrorOf(() => lineChannel.create({ ...CONFIG, botUserId: 7 })).detail).toBe(
      "botUserId",
    );
    expect(
      configurationErrorOf(() => lineChannel.create({ ...CONFIG, requireMention: "yes" })).detail,
    ).toBe("requireMention");
  });

  it("refuses an empty access token through the adapter's own check", () => {
    expect(
      configurationErrorOf(() =>
        lineChannel.create({ channelSecret: SECRET, channelAccessToken: "" }),
      ).code,
    ).toBe("access_token_required");
  });

  it("treats a null or empty optional field as absent", () => {
    expect(lineChannel.create({ ...CONFIG, botUserId: "", requireMention: null })).toBeInstanceOf(
      LineAdapter,
    );
  });
});
