import { GatewayRunner } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeYuanbaoSignature,
  splitForYuanbao,
  YuanbaoAdapter,
  type YuanbaoFetch,
} from "../src/index.js";

const SECRET = "cb";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

function fakeFetch(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetch: YuanbaoFetch = async (url, init) => {
    const call = {
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
  c.url.endsWith("/auth/token")
    ? { code: 0, data: { access_token: "AT", expires_in: 7200 } }
    : { code: 0, data: { message_id: "m1" } };

const make = (f: YuanbaoFetch) =>
  new YuanbaoAdapter({ appId: "a", appSecret: "s", callbackSecret: SECRET, fetch: f });

const body = (id = "m1", text = "hi") =>
  JSON.stringify({
    type: "message",
    message: { id, text, create_time: 1700000000, from: { id: "u1" } },
  });

function signed(raw: string, ts = String(Math.floor(Date.now() / 1000))) {
  return [raw, computeYuanbaoSignature(SECRET, ts, raw), ts] as const;
}

const adapters: YuanbaoAdapter[] = [];
afterEach(async () => {
  for (const a of adapters.splice(0)) await a.disconnect();
});
function started(f: YuanbaoFetch) {
  const a = make(f);
  adapters.push(a);
  return a;
}

describe("YuanbaoAdapter", () => {
  it("requires every credential", () => {
    for (const key of ["appId", "appSecret", "callbackSecret"] as const) {
      const opts = { appId: "a", appSecret: "s", callbackSecret: "c", [key]: "" };
      expect(() => new YuanbaoAdapter(opts)).toThrow(key);
    }
  });

  it("connects with the token exchange and fails softly", async () => {
    const good = started(fakeFetch(ok).fetch);
    expect(await good.connect()).toBe(true);
    const bad = started(fakeFetch(() => ({ code: 10001, msg: "bad secret" })).fetch);
    expect(await bad.connect()).toBe(false);
    const junk = started(fakeFetch(() => "<html>").fetch);
    expect(await junk.connect()).toBe(false);
  });

  it("sends a reply with the bearer token, split, and reports a refusal", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = started(fetch);
    await a.connect();
    const res = await a.sendMessage({ channel: { id: "u1", type: "dm" }, text: "x".repeat(4500) });
    expect(res).toEqual({ ok: true, messageId: "m1" });
    const sends = calls.filter((c) => c.url.endsWith("/message/send"));
    expect(sends).toHaveLength(3);
    expect(sends[0]?.headers.Authorization).toBe("Bearer AT");
    expect(sends[0]?.body).toMatchObject({ receive_id: "u1", msg_type: "text" });

    const refused = started(
      fakeFetch((c) => (c.url.endsWith("/auth/token") ? ok(c) : { code: 7, msg: "no" })).fetch,
    );
    await refused.connect();
    const r = await refused.sendMessage({ channel: { id: "u1", type: "dm" }, text: "y" });
    expect(r).toMatchObject({ ok: false, error: { code: "yuanbao_send_failed" } });
  });

  it("refuses bad sends before any call", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = started(fetch);
    const dm = { id: "u1", type: "dm" as const };
    expect(await a.sendMessage({ channel: dm, text: "x" })).toMatchObject({
      error: { code: "not_connected" },
    });
    await a.connect();
    const before = calls.length;
    expect(await a.sendMessage({ channel: dm, text: "" })).toMatchObject({
      error: { code: "empty_text" },
    });
    expect(await a.sendMessage({ channel: { id: "", type: "dm" }, text: "x" })).toMatchObject({
      error: { code: "invalid_channel" },
    });
    expect(
      await a.sendMessage({ channel: dm, text: "x", attachments: [{} as never] }),
    ).toMatchObject({ error: { code: "attachments_unsupported" } });
    expect(calls).toHaveLength(before);
  });

  it("answers 400 to a signed body that is not a JSON object", async () => {
    const a = started(fakeFetch(ok).fetch);
    const seen: string[] = [];
    a.onInbound(async (e) => void seen.push(e.text));
    for (const raw of ["null", "42", '"text"', "[]", "true"]) {
      expect(await a.handleWebhook(...signed(raw))).toEqual({
        status: 400,
        reason: "body is not a JSON object",
      });
    }
    expect(seen).toEqual([]);
  });

  it("verifies, dispatches once, and answers by outcome", async () => {
    const a = started(fakeFetch(ok).fetch);
    const seen: string[] = [];
    expect((await a.handleWebhook(...signed(body()))).status).toBe(503);
    a.onInbound(async (e) => void seen.push(e.text));
    expect(await a.handleWebhook(...signed(body()))).toEqual({ status: 200, reason: "ok" });
    expect((await a.handleWebhook(...signed(body()))).reason).toBe("duplicate");
    expect(seen).toEqual(["hi"]);
    expect((await a.handleWebhook(body(), "00", "1")).status).toBe(401);
    const [raw, sig] = signed(body("m2"));
    expect((await a.handleWebhook(raw, sig, "1")).status).toBe(401);
    expect((await a.handleWebhook(raw, undefined, undefined)).status).toBe(401);
    expect((await a.handleWebhook(...signed("not json"))).status).toBe(400);
    expect((await a.handleWebhook(...signed(JSON.stringify({ type: "follow" })))).reason).toBe(
      "not a text message",
    );
  });

  it("acknowledges a throwing handler", async () => {
    const a = started(fakeFetch(ok).fetch);
    a.onInbound(async () => {
      throw new Error("boom");
    });
    expect((await a.handleWebhook(...signed(body("m9")))).reason).toBe("handler_threw");
  });

  it("answers through GatewayRunner", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = started(fetch);
    const runner = new GatewayRunner({
      adapters: [a],
      handler: async (_e, ctx) => {
        await ctx.reply("pong");
      },
    });
    await runner.start();
    try {
      await a.handleWebhook(...signed(body("m5", "ping")));
      const sent = calls.find((c) => c.url.endsWith("/message/send"));
      expect(sent?.body.content.text).toBe("pong");
    } finally {
      await runner.stop();
    }
  });

  it("splits without empty parts", () => {
    expect(splitForYuanbao("")).toEqual([]);
    expect(splitForYuanbao("a".repeat(2001))).toHaveLength(2);
  });
});
