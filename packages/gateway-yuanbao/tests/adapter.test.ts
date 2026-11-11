import { GatewayRunner } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeYuanbaoSignature,
  splitForYuanbao,
  YuanbaoAdapter,
  type YuanbaoFetch,
} from "../src/index.js";

const SECRET = "sec";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetch: YuanbaoFetch = async (url, init) => {
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

const ok = (c: Call) =>
  c.url.endsWith("/sign-token") ? { code: 0, data: { token: "TK", duration: 7200 } } : { code: 0 };

function make(f: YuanbaoFetch) {
  return new YuanbaoAdapter({ appKey: "key1", appSecret: SECRET, fetch: f });
}

function sign(body: string, ts = "1700000000", nonce = "n1") {
  return { timestamp: ts, nonce, signature: computeYuanbaoSignature(SECRET, ts, nonce, body) };
}

const BODY = JSON.stringify({
  msg_id: "m1",
  msg_type: "text",
  from_account: "u1",
  content: "hi 你好",
  create_time: 1700000000,
});

describe("construction", () => {
  it("rejects a missing credential", () => {
    expect(() => new YuanbaoAdapter({ appKey: "", appSecret: "s" })).toThrow(/appKey/);
    expect(() => new YuanbaoAdapter({ appKey: "k", appSecret: "" })).toThrow(/appSecret/);
  });
});

describe("connect", () => {
  it("is true when the token endpoint answers a token", async () => {
    const { fetch, calls } = fakeFetch(ok);
    expect(await make(fetch).connect()).toBe(true);
    expect(calls[0]?.url).toBe("https://bot.yuanbao.tencent.com/api/v5/robotLogic/sign-token");
    expect(calls[0]?.body).toMatchObject({ app_key: "key1" });
  });
  it("is false for a refusal, a network failure and a bad body", async () => {
    expect(await make(fakeFetch(() => ({ code: 10001, msg: "bad" })).fetch).connect()).toBe(false);
    const boom: YuanbaoFetch = async () => {
      throw new Error("down");
    };
    expect(await make(boom).connect()).toBe(false);
    expect(await make(fakeFetch(() => "<html>").fetch).connect()).toBe(false);
    expect(await make(fakeFetch(() => ({ code: 0 })).fetch).connect()).toBe(false);
  });
});

describe("sendMessage", () => {
  const out = { channel: { id: "u1", type: "dm" as const }, text: "yo" };
  it("posts the text with the token", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = make(fetch);
    await a.connect();
    expect(await a.sendMessage(out)).toEqual({ ok: true, messageId: "" });
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "https://bot.yuanbao.tencent.com/api/v1/bot/message/send",
      headers: { "X-Token": "TK" },
      body: { to_account: "u1", msg_type: "text", content: "yo" },
    });
  });
  it("splits long text in order and strips markdown", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = make(fetch);
    await a.connect();
    await a.sendMessage({ ...out, text: "a".repeat(4500) });
    const sent = calls.slice(1).map((c) => (c.body as { content: string }).content);
    expect(sent.map((s) => s.length)).toEqual([2000, 2000, 500]);
    expect(splitForYuanbao("")).toEqual([]);
    await a.sendMessage({ ...out, text: "**b**", format: "markdown" });
    expect(calls.at(-1)?.body).toMatchObject({ content: "b" });
  });
  it("fetches a new token once the old one has expired", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.endsWith("/sign-token") ? { code: 0, data: { token: "T", duration: 1 } } : { code: 0 },
    );
    const a = make(fetch);
    await a.connect();
    await a.sendMessage(out);
    expect(calls.filter((c) => c.url.endsWith("/sign-token"))).toHaveLength(2);
  });
  it("reports refusals without a throw", async () => {
    const a = make(fakeFetch(ok).fetch);
    expect((await a.sendMessage(out)).ok).toBe(false);
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
      fakeFetch((c) => (c.url.endsWith("/sign-token") ? ok(c) : { code: 4003, msg: "no" })).fetch,
    );
    await refused.connect();
    expect(await refused.sendMessage(out)).toMatchObject({
      error: { code: "yuanbao_send_failed", message: expect.stringContaining("4003") },
    });
  });
});

describe("handleWebhook", () => {
  it("dispatches a signed text message once and refuses a bad signature", async () => {
    const a = make(fakeFetch(ok).fetch);
    const seen: unknown[] = [];
    a.onInbound(async (e) => void seen.push({ id: e.id, text: e.text, channel: e.channel }));
    expect((await a.handleWebhook({ ...sign(BODY), signature: "00" }, BODY)).status).toBe(401);
    expect((await a.handleWebhook({ timestamp: "1" }, BODY)).status).toBe(401);
    expect((await a.handleWebhook(sign(`${BODY} `), BODY)).status).toBe(401);
    expect(await a.handleWebhook(sign(BODY), BODY)).toMatchObject({ status: 200, body: "success" });
    expect((await a.handleWebhook(sign(BODY), BODY)).reason).toBe("duplicate");
    expect(seen).toEqual([{ id: "m1", text: "hi 你好", channel: { id: "u1", type: "dm" } }]);
  });
  it("rejects bad bodies, skips other types, answers 503 with no handler, contains a throw", async () => {
    const a = make(fakeFetch(ok).fetch);
    expect((await a.handleWebhook(sign("nope"), "nope")).status).toBe(400);
    const gap = JSON.stringify({ msg_type: "text", content: "x" });
    expect((await a.handleWebhook(sign(gap), gap)).status).toBe(400);
    const image = JSON.stringify({ msg_type: "image", msg_id: "i" });
    expect((await a.handleWebhook(sign(image), image)).status).toBe(200);
    expect((await a.handleWebhook(sign(BODY), BODY)).status).toBe(503);
    a.onInbound(async () => {
      throw new Error("boom");
    });
    expect(await a.handleWebhook(sign(BODY), BODY)).toMatchObject({
      status: 200,
      reason: "handler_threw",
    });
  });
});

describe("GatewayRunner drives YuanbaoAdapter", () => {
  const running: GatewayRunner[] = [];
  afterEach(async () => {
    for (const r of running.splice(0)) await r.stop();
  });
  it("replies to a webhook message through ctx.reply", async () => {
    const { fetch, calls } = fakeFetch(ok);
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
    await adapter.handleWebhook(sign(BODY), BODY);
    await handled;
    expect(calls.at(-1)?.body).toEqual({
      to_account: "u1",
      msg_type: "text",
      content: "hello back",
    });
  });
});
