import { GatewayRunner } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeWeComSignature,
  decryptWeCom,
  encryptWeCom,
  parseWeComXml,
  splitForWeCom,
  WeComAdapter,
  type WeComFetch,
} from "../src/index.js";

const TOKEN = "tok";
const AES = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
const CORP = "ww1";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function fakeFetch(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetch: WeComFetch = async (url, init) => {
    const call = { method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const out = answer(call);
    return { status: 200, text: async () => (typeof out === "string" ? out : JSON.stringify(out)) };
  };
  return { fetch, calls };
}

const ok = (c: Call) =>
  c.url.includes("/cgi-bin/gettoken")
    ? { access_token: "AT", expires_in: 7200 }
    : { errcode: 0, errmsg: "ok" };

function make(f: WeComFetch) {
  return new WeComAdapter({
    corpId: CORP,
    corpSecret: "sec",
    agentId: 1000002,
    token: TOKEN,
    encodingAesKey: AES,
    fetch: f,
  });
}

const PLAIN = `<xml><ToUserName><![CDATA[ww1]]></ToUserName><FromUserName><![CDATA[u1]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hi 你好]]></Content><MsgId>123</MsgId><AgentID>1000002</AgentID></xml>`;

function signed(encrypted: string, ts = "1700000000", nonce = "n1") {
  return {
    timestamp: ts,
    nonce,
    msg_signature: computeWeComSignature(TOKEN, ts, nonce, encrypted),
  };
}

function post(plain: string) {
  const encrypted = encryptWeCom(AES, plain, CORP);
  return {
    q: signed(encrypted),
    body: `<xml><ToUserName><![CDATA[ww1]]></ToUserName><Encrypt><![CDATA[${encrypted}]]></Encrypt><AgentID><![CDATA[1000002]]></AgentID></xml>`,
  };
}

const XML = PLAIN;

describe("construction and xml", () => {
  it("rejects a missing credential", () => {
    expect(
      () =>
        new WeComAdapter({
          corpId: "",
          corpSecret: "s",
          agentId: 1,
          token: "t",
          encodingAesKey: AES,
        }),
    ).toThrow(/corpId/);
    expect(
      () =>
        new WeComAdapter({
          corpId: "c",
          corpSecret: "s",
          agentId: "",
          token: "t",
          encodingAesKey: AES,
        }),
    ).toThrow(/agentId/);
  });
  it("parses CDATA and plain tags", () => {
    expect(parseWeComXml(XML)).toMatchObject({
      FromUserName: "u1",
      Content: "hi 你好",
      MsgId: "123",
    });
    expect(parseWeComXml("<xml><A>a &amp; b</A></xml>")).toEqual({ A: "a & b" });
  });
});

describe("connect", () => {
  it("is true when the token endpoint answers a token", async () => {
    const { fetch, calls } = fakeFetch(ok);
    expect(await make(fetch).connect()).toBe(true);
    expect(calls[0]?.url).toBe(
      "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=ww1&corpsecret=sec",
    );
  });
  it("is false for a refused secret, a network failure and a non-JSON body", async () => {
    expect(
      await make(
        fakeFetch(() => ({ errcode: 40125, errmsg: "invalid appsecret" })).fetch,
      ).connect(),
    ).toBe(false);
    const boom: WeComFetch = async () => {
      throw new Error("down");
    };
    expect(await make(boom).connect()).toBe(false);
    expect(await make(fakeFetch(() => "<html>").fetch).connect()).toBe(false);
    expect(await make(fakeFetch(() => ({})).fetch).connect()).toBe(false);
  });
});

describe("sendMessage", () => {
  const out = { channel: { id: "o1", type: "dm" as const }, text: "yo" };
  it("posts to the application message endpoint with the token", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = make(fetch);
    await a.connect();
    expect(await a.sendMessage(out)).toEqual({ ok: true, messageId: "" });
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=AT",
      body: { touser: "o1", msgtype: "text", agentid: 1000002, text: { content: "yo" } },
    });
  });
  it("splits long text in order and strips markdown", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = make(fetch);
    await a.connect();
    await a.sendMessage({ ...out, text: "a".repeat(1300) });
    const sent = calls.slice(1).map((c) => (c.body as { text: { content: string } }).text.content);
    expect(sent.map((s) => s.length)).toEqual([600, 600, 100]);
    expect(splitForWeCom("")).toEqual([]);
    await a.sendMessage({ ...out, text: "**b**", format: "markdown" });
    expect(calls.at(-1)?.body).toMatchObject({ text: { content: "b" } });
  });
  it("fetches a new token once the old one has expired", async () => {
    const { fetch, calls } = fakeFetch((c) =>
      c.url.includes("/cgi-bin/gettoken")
        ? { access_token: `AT${calls.length}`, expires_in: 1 }
        : { errcode: 0 },
    );
    const a = make(fetch);
    await a.connect();
    await a.sendMessage(out);
    expect(calls.filter((c) => c.url.includes("/cgi-bin/gettoken"))).toHaveLength(2);
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
        c.url.includes("/cgi-bin/gettoken") ? ok(c) : { errcode: 45015, errmsg: "window" },
      ).fetch,
    );
    await refused.connect();
    expect(await refused.sendMessage(out)).toMatchObject({
      error: { code: "wecom_send_failed", message: expect.stringContaining("45015") },
    });
  });
});

describe("handleWebhook", () => {
  it("round-trips the envelope and rejects another corp id", () => {
    expect(decryptWeCom(AES, encryptWeCom(AES, "héllo", CORP), CORP)).toBe("héllo");
    expect(() => decryptWeCom(AES, encryptWeCom(AES, "x", "other"), CORP)).toThrow();
    expect(() => decryptWeCom("short", "AAAA", CORP)).toThrow();
  });
  it("answers the verification GET with the decrypted echostr, and refuses a bad signature", async () => {
    const a = make(fakeFetch(ok).fetch);
    const echostr = encryptWeCom(AES, "ECHO", CORP);
    expect(await a.handleWebhook({ ...signed(echostr), echostr })).toMatchObject({
      status: 200,
      body: "ECHO",
    });
    expect(
      (await a.handleWebhook({ ...signed(echostr), msg_signature: "00", echostr })).status,
    ).toBe(401);
    expect((await a.handleWebhook({ timestamp: "1" })).status).toBe(400);
    expect((await a.handleWebhook({ ...signed("junk"), echostr: "junk" })).status).toBe(400);
  });
  it("dispatches a signed encrypted text message once", async () => {
    const a = make(fakeFetch(ok).fetch);
    const seen: unknown[] = [];
    a.onInbound(async (e) => void seen.push({ id: e.id, text: e.text, channel: e.channel }));
    const { q, body } = post(XML);
    expect((await a.handleWebhook({ ...q, msg_signature: "00" }, body)).status).toBe(401);
    expect(await a.handleWebhook(q, body)).toMatchObject({ status: 200, body: "success" });
    expect((await a.handleWebhook(q, body)).reason).toBe("duplicate");
    expect(seen).toEqual([{ id: "123", text: "hi 你好", channel: { id: "u1", type: "dm" } }]);
  });
  it("acknowledges other message types, answers 503 with no handler, contains a throw", async () => {
    const a = make(fakeFetch(ok).fetch);
    const other = post(XML.replace("<![CDATA[text]]>", "<![CDATA[event]]>"));
    expect((await a.handleWebhook(other.q, other.body)).status).toBe(200);
    const { q, body } = post(XML);
    expect((await a.handleWebhook(q, body)).status).toBe(503);
    a.onInbound(async () => {
      throw new Error("boom");
    });
    expect(await a.handleWebhook(q, body)).toMatchObject({
      status: 200,
      reason: "handler_threw",
    });
  });
});

describe("GatewayRunner drives WeComAdapter", () => {
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
    const { q, body } = post(XML);
    await adapter.handleWebhook(q, body);
    await handled;
    expect(calls.at(-1)?.body).toEqual({
      touser: "u1",
      msgtype: "text",
      agentid: 1000002,
      text: { content: "hello back" },
    });
  });
});
