import { GatewayRunner } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";
import {
  fakeFetch,
  okAnswer,
  registerWeixinAdapterCases,
} from "../../../shared/weixin-adapter-cases.js";
import {
  computeWeChatSignature,
  parseWeChatXml,
  splitForWeChat,
  WECHAT_MESSAGE_LIMIT,
  WeChatAdapter,
  type WeChatFetch,
} from "../src/index.js";

const TOKEN = "tok";

const ok = okAnswer("/cgi-bin/token");

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

describe("construction", () => {
  it("rejects a missing credential", () => {
    expect(() => new WeChatAdapter({ appId: "", appSecret: "s", token: "t" })).toThrow(/appId/);
  });
});

registerWeixinAdapterCases(
  { describe, it, afterEach, expect, GatewayRunner: GatewayRunner as never },
  {
    name: "WeChatAdapter",
    make,
    parseXml: parseWeChatXml,
    xml: XML,
    sender: "o1",
    tokenPath: "/cgi-bin/token",
    tokenUrl:
      "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=wx1&secret=sec",
    sendUrl: "https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=AT",
    sendBody: (touser, content) => ({ touser, msgtype: "text", text: { content } }),
    sendFailedCode: "wechat_send_failed",
    splitFor: splitForWeChat,
    signed: (body) => ({ query: query(), body }),
    badSignature: (q) => ({ ...q, signature: "00" }),
  },
);

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
});

describe("WeChatAdapter.capabilities", () => {
  it("reports the splitter limit and threads", () => {
    const c = new WeChatAdapter({ appId: "wx1", appSecret: "s", token: "t" }).capabilities;
    expect(c.maxMessageChars).toBe(WECHAT_MESSAGE_LIMIT);
    expect(c.threads).toBe(false);
  });
});
