import { GatewayRunner } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";
import {
  fakeFetch,
  okAnswer,
  registerWeixinAdapterCases,
} from "../../../shared/weixin-adapter-cases.js";
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

const ok = okAnswer("/cgi-bin/gettoken");

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

describe("construction", () => {
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
});

registerWeixinAdapterCases(
  { describe, it, afterEach, expect, GatewayRunner: GatewayRunner as never },
  {
    name: "WeComAdapter",
    make,
    parseXml: parseWeComXml,
    xml: XML,
    sender: "u1",
    tokenPath: "/cgi-bin/gettoken",
    tokenUrl: "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=ww1&corpsecret=sec",
    sendUrl: "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=AT",
    sendBody: (touser, content) => ({
      touser,
      msgtype: "text",
      agentid: 1000002,
      text: { content },
    }),
    sendFailedCode: "wecom_send_failed",
    splitFor: splitForWeCom,
    signed: (plain) => {
      const { q, body } = post(plain);
      return { query: q, body };
    },
    badSignature: (query) => ({ ...query, msg_signature: "00" }),
  },
);

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
});
