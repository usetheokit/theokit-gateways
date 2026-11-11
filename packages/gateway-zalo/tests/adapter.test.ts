import { GatewayRunner } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { computeZaloSignature, splitForZalo, ZaloAdapter, type ZaloFetch } from "../src/index.js";

const APP = "app1";
const SECRET = "oa-secret";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(answer: (call: Call) => unknown = () => ({ error: 0, message: "Success" })) {
  const calls: Call[] = [];
  const fetch: ZaloFetch = async (url, init) => {
    const call = {
      method: init.method,
      url,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const out = answer(call);
    return { status: 200, text: async () => (typeof out === "string" ? out : JSON.stringify(out)) };
  };
  return { fetch, calls };
}

function make(f: ZaloFetch) {
  return new ZaloAdapter({ appId: APP, oaSecretKey: SECRET, accessToken: "tok", fetch: f });
}

function signed(event: object): { body: string; sig: string } {
  const body = JSON.stringify(event);
  const ts = String((event as { timestamp: string }).timestamp);
  return { body, sig: `mac=${computeZaloSignature(APP, body, ts, SECRET)}` };
}

const TEXT = {
  app_id: APP,
  event_name: "user_send_text",
  sender: { id: "u1" },
  recipient: { id: "oa1" },
  message: { text: "hi", msg_id: "m1" },
  timestamp: "1700000000000",
};

describe("ZaloAdapter construction", () => {
  it("rejects a missing credential", () => {
    expect(() => new ZaloAdapter({ appId: "", oaSecretKey: "s", accessToken: "t" })).toThrow(
      /appId/,
    );
  });
});

describe("connect", () => {
  it("is true when getoa answers error 0, with the token header", async () => {
    const { fetch, calls } = fakeFetch();
    expect(await make(fetch).connect()).toBe(true);
    expect(calls[0]?.url).toBe("https://openapi.zalo.me/v2.0/oa/getoa");
    expect(calls[0]?.headers.access_token).toBe("tok");
  });
  it("is false for a refused token and for a network failure", async () => {
    expect(
      await make(fakeFetch(() => ({ error: -216, message: "bad token" })).fetch).connect(),
    ).toBe(false);
    const boom: ZaloFetch = async () => {
      throw new Error("down");
    };
    expect(await make(boom).connect()).toBe(false);
    expect(await make(fakeFetch(() => "<html>").fetch).connect()).toBe(false);
  });
});

describe("sendMessage", () => {
  it("posts to the customer-service endpoint and returns the message id", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.method === "POST" ? { error: 0, data: { message_id: "z9" } } : { error: 0 },
    );
    const a = make(fetch);
    await a.connect();
    const r = await a.sendMessage({ channel: { id: "u1", type: "dm" }, text: "yo" });
    expect(r).toEqual({ ok: true, messageId: "z9" });
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "https://openapi.zalo.me/v3.0/oa/message/cs",
      body: { recipient: { user_id: "u1" }, message: { text: "yo" } },
    });
  });
  it("splits over 2000 characters, in order, and strips markdown", async () => {
    const { fetch, calls } = fakeFetch();
    const a = make(fetch);
    await a.connect();
    await a.sendMessage({ channel: { id: "u1", type: "dm" }, text: "a".repeat(4500) });
    const sent = calls.slice(1).map((c) => (c.body as { message: { text: string } }).message.text);
    expect(sent.map((s) => s.length)).toEqual([2000, 2000, 500]);
    expect(splitForZalo("")).toEqual([]);
    await a.sendMessage({ channel: { id: "u1", type: "dm" }, text: "**b**", format: "markdown" });
    expect(calls.at(-1)?.body).toMatchObject({ message: { text: "b" } });
  });
  it("reports refusals without a throw", async () => {
    const a = make(fakeFetch().fetch);
    const out = { channel: { id: "u1", type: "dm" as const }, text: "x" };
    expect((await a.sendMessage(out)).ok).toBe(false); // not connected
    await a.connect();
    expect(await a.sendMessage({ ...out, text: "" })).toMatchObject({
      error: { code: "empty_text" },
    });
    expect(await a.sendMessage({ ...out, channel: { id: "", type: "dm" } })).toMatchObject({
      error: { code: "invalid_channel" },
    });
    expect(
      await a.sendMessage({ ...out, attachments: [{ kind: "image", url: "u" }] } as never),
    ).toMatchObject({ error: { code: "attachments_unsupported" } });
    const refused = make(
      fakeFetch((c) => (c.method === "POST" ? { error: -233, message: "window" } : { error: 0 }))
        .fetch,
    );
    await refused.connect();
    expect(await refused.sendMessage(out)).toMatchObject({
      error: { code: "zalo_send_failed", message: expect.stringContaining("-233") },
    });
  });
});

describe("handleWebhook", () => {
  it("rejects a bad or missing signature and dispatches nothing", async () => {
    const a = make(fakeFetch().fetch);
    const seen: string[] = [];
    a.onInbound(async (e) => void seen.push(e.id));
    const { body } = signed(TEXT);
    expect((await a.handleWebhook(body, "mac=00")).status).toBe(401);
    expect((await a.handleWebhook(body, undefined)).status).toBe(401);
    expect((await a.handleWebhook("not json", "mac=00")).status).toBe(401);
    expect(seen).toEqual([]);
  });
  it("dispatches a signed text event once", async () => {
    const a = make(fakeFetch().fetch);
    const seen: { id: string; text: string; channel: unknown }[] = [];
    a.onInbound(async (e) => void seen.push({ id: e.id, text: e.text, channel: e.channel }));
    const { body, sig } = signed(TEXT);
    expect((await a.handleWebhook(body, sig)).status).toBe(200);
    expect((await a.handleWebhook(body, sig)).reason).toBe("duplicate");
    expect(seen).toEqual([{ id: "m1", text: "hi", channel: { id: "u1", type: "dm" } }]);
  });
  it("acknowledges non-text events and another app's, but not a missing handler", async () => {
    const a = make(fakeFetch().fetch);
    const follow = signed({ ...TEXT, event_name: "follow" });
    expect((await a.handleWebhook(follow.body, follow.sig)).status).toBe(200);
    const other = signed({ ...TEXT, app_id: "other" });
    expect((await a.handleWebhook(other.body, other.sig)).status).toBe(200);
    const text = signed(TEXT);
    expect((await a.handleWebhook(text.body, text.sig)).status).toBe(503);
  });
  it("contains a throwing handler", async () => {
    const a = make(fakeFetch().fetch);
    a.onInbound(async () => {
      throw new Error("boom");
    });
    const { body, sig } = signed(TEXT);
    expect(await a.handleWebhook(body, sig)).toEqual({ status: 200, reason: "handler_threw" });
  });
});

describe("GatewayRunner drives ZaloAdapter", () => {
  const running: GatewayRunner[] = [];
  afterEach(async () => {
    for (const r of running.splice(0)) await r.stop();
  });
  it("replies to a webhook message through ctx.reply", async () => {
    const { fetch, calls } = fakeFetch();
    const adapter = make(fetch);
    let done: () => void = () => undefined;
    const handled = new Promise<void>((r) => (done = r));
    const runner = new GatewayRunner({
      adapters: [adapter],
      handler: async (_e, ctx) => {
        await ctx.reply("hello back");
        done();
      },
    });
    running.push(runner);
    await runner.start();
    const { body, sig } = signed(TEXT);
    await adapter.handleWebhook(body, sig);
    await handled;
    expect(calls.at(-1)?.body).toEqual({
      recipient: { user_id: "u1" },
      message: { text: "hello back" },
    });
  });
});
