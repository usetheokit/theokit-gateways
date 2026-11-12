import { GatewayRunner } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeWeChatSignature,
  parseWeChatXml,
  splitForWeChat,
  WeChatAdapter,
  type WeChatFetch,
} from "../src/index.js";

const TOKEN = "tok";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function fakeFetch(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetch: WeChatFetch = async (url, init) => {
    const call = { method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const out = answer(call);
    return { status: 200, text: async () => (typeof out === "string" ? out : JSON.stringify(out)) };
  };
  return { fetch, calls };
}

const ok = (c: Call) =>
  c.url.includes("/cgi-bin/token")
    ? { access_token: "AT", expires_in: 7200 }
    : { errcode: 0, errmsg: "ok" };

function make(f: WeChatFetch) {
  return new WeChatAdapter({ appId: "wx1", appSecret: "sec", token: TOKEN, fetch: f });
}

let nonceCount = 0;

/** A query signed now, with a nonce no other request in the file uses. */
function query() {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = `n${++nonceCount}`;
  return { timestamp: ts, nonce, signature: computeWeChatSignature(TOKEN, ts, nonce) };
}

const XML = `<xml><ToUserName><![CDATA[gh_1]]></ToUserName><FromUserName><![CDATA[o1]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hi 你好]]></Content><MsgId>123</MsgId></xml>`;

describe("construction and xml", () => {
  it("rejects a missing credential", () => {
    expect(() => new WeChatAdapter({ appId: "", appSecret: "s", token: "t" })).toThrow(/appId/);
  });
  it("parses CDATA and plain tags", () => {
    expect(parseWeChatXml(XML)).toMatchObject({
      FromUserName: "o1",
      Content: "hi 你好",
      MsgId: "123",
    });
    expect(parseWeChatXml("<xml><A>a &amp; b</A></xml>")).toEqual({ A: "a & b" });
  });
});

describe("connect", () => {
  it("is true when the token endpoint answers a token", async () => {
    const { fetch, calls } = fakeFetch(ok);
    expect(await make(fetch).connect()).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=wx1&secret=sec",
    );
  });
  it("is false for a refused secret, a network failure and a non-JSON body", async () => {
    expect(
      await make(
        fakeFetch(() => ({ errcode: 40125, errmsg: "invalid appsecret" })).fetch,
      ).connect(),
    ).toBe(false);
    const boom: WeChatFetch = async () => {
      throw new Error("down");
    };
    expect(await make(boom).connect()).toBe(false);
    expect(await make(fakeFetch(() => "<html>").fetch).connect()).toBe(false);
    expect(await make(fakeFetch(() => ({})).fetch).connect()).toBe(false);
  });
});

describe("sendMessage", () => {
  const out = { channel: { id: "o1", type: "dm" as const }, text: "yo" };
  it("posts to the customer-service endpoint with the token", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = make(fetch);
    await a.connect();
    expect(await a.sendMessage(out)).toEqual({ ok: true, messageId: "" });
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=AT",
      body: { touser: "o1", msgtype: "text", text: { content: "yo" } },
    });
  });
  it("splits long text in order and strips markdown", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = make(fetch);
    await a.connect();
    await a.sendMessage({ ...out, text: "a".repeat(1300) });
    const sent = calls.slice(1).map((c) => (c.body as { text: { content: string } }).text.content);
    expect(sent.map((s) => s.length)).toEqual([600, 600, 100]);
    expect(splitForWeChat("")).toEqual([]);
    await a.sendMessage({ ...out, text: "**b**", format: "markdown" });
    expect(calls.at(-1)?.body).toMatchObject({ text: { content: "b" } });
  });
  it("fetches a new token once the old one has expired", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.includes("/cgi-bin/token")
        ? { access_token: `AT${calls.length}`, expires_in: 1 }
        : { errcode: 0 },
    );
    const a = make(fetch);
    await a.connect();
    await a.sendMessage(out);
    expect(calls.filter((c) => c.url.includes("/cgi-bin/token"))).toHaveLength(2);
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
      fakeFetch((c) =>
        c.url.includes("/cgi-bin/token") ? ok(c) : { errcode: 45015, errmsg: "window" },
      ).fetch,
    );
    await refused.connect();
    expect(await refused.sendMessage(out)).toMatchObject({
      error: { code: "wechat_send_failed", message: expect.stringContaining("45015") },
    });
  });
});

describe("handleWebhook", () => {
  it("answers the verification GET with echostr, and refuses a bad signature", async () => {
    const a = make(fakeFetch(ok).fetch);
    expect(await a.handleWebhook({ ...query(), echostr: "E1" })).toMatchObject({
      status: 200,
      body: "E1",
    });
    expect((await a.handleWebhook({ ...query(), signature: "00", echostr: "E1" })).status).toBe(
      401,
    );
    expect((await a.handleWebhook({ timestamp: "1" })).status).toBe(401);
  });
  it("dispatches a signed text message once", async () => {
    const a = make(fakeFetch(ok).fetch);
    const seen: unknown[] = [];
    a.onInbound(async (e) => void seen.push({ id: e.id, text: e.text, channel: e.channel }));
    expect((await a.handleWebhook({ ...query(), signature: "00" }, XML)).status).toBe(401);
    const signed = query();
    expect(await a.handleWebhook(signed, XML)).toMatchObject({ status: 200, body: "success" });
    expect((await a.handleWebhook(signed, XML)).reason).toBe("duplicate");
    expect(seen).toEqual([{ id: "123", text: "hi 你好", channel: { id: "o1", type: "dm" } }]);
  });
  it("acknowledges other message types, answers 503 with no handler, contains a throw", async () => {
    const a = make(fakeFetch(ok).fetch);
    const event = XML.replace("<![CDATA[text]]>", "<![CDATA[event]]>");
    expect((await a.handleWebhook(query(), event)).status).toBe(200);
    expect((await a.handleWebhook(query(), XML)).status).toBe(503);
    a.onInbound(async () => {
      throw new Error("boom");
    });
    expect(await a.handleWebhook(query(), XML)).toMatchObject({
      status: 200,
      reason: "handler_threw",
    });
  });
});

describe("GatewayRunner drives WeChatAdapter", () => {
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
    await adapter.handleWebhook(query(), XML);
    await handled;
    expect(calls.at(-1)?.body).toEqual({
      touser: "o1",
      msgtype: "text",
      text: { content: "hello back" },
    });
  });
});
