import { GatewayRunner } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { QQAdapter, type QQFetch, signQQ, splitForQQ, verifyQQSignature } from "../src/index.js";

const SECRET = "naOC0ocQE3shWLAfffVLB6rSwMMFBAtd";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

function fakeFetch(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const fetch: QQFetch = async (url, init) => {
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
  c.url.includes("getAppAccessToken")
    ? { access_token: "AT", expires_in: "7200" }
    : { id: "m1", timestamp: 1 };

const make = (f: QQFetch) => new QQAdapter({ appId: "a", clientSecret: SECRET, fetch: f });

const body = (id = "m1", text = " hi ") =>
  JSON.stringify({
    id: "ev1",
    op: 0,
    t: "C2C_MESSAGE_CREATE",
    d: { id, content: text, timestamp: "2023-11-14T22:13:20+08:00", author: { user_openid: "u1" } },
  });

function signed(raw: string, ts = String(Math.floor(Date.now() / 1000))) {
  return [raw, signQQ(SECRET, ts + raw), ts] as const;
}

const adapters: QQAdapter[] = [];
afterEach(async () => {
  for (const a of adapters.splice(0)) await a.disconnect();
});
function started(f: QQFetch) {
  const a = make(f);
  adapters.push(a);
  return a;
}

describe("QQAdapter", () => {
  it("requires every credential", () => {
    for (const key of ["appId", "clientSecret"] as const) {
      const opts = { appId: "a", clientSecret: "s", [key]: "" };
      expect(() => new QQAdapter(opts)).toThrow(key);
    }
  });

  it("connects with the token exchange and fails softly", async () => {
    const { fetch, calls } = fakeFetch(ok);
    expect(await started(fetch).connect()).toBe(true);
    expect(calls[0]?.url).toBe("https://bots.qq.com/app/getAppAccessToken");
    expect(calls[0]?.body).toEqual({ appId: "a", clientSecret: SECRET });
    const bad = started(fakeFetch(() => ({ code: 100016, message: "bad secret" })).fetch);
    expect(await bad.connect()).toBe(false);
    const junk = started(fakeFetch(() => "<html>").fetch);
    expect(await junk.connect()).toBe(false);
  });

  it("sends a C2C message with the QQBot token, split, and reports a refusal", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = started(fetch);
    await a.connect();
    const res = await a.sendMessage({ channel: { id: "u1", type: "dm" }, text: "x".repeat(4500) });
    expect(res).toEqual({ ok: true, messageId: "m1" });
    const sends = calls.filter((c) => c.url.includes("/messages"));
    expect(sends).toHaveLength(3);
    expect(sends[0]?.url).toBe("https://api.sgroup.qq.com/v2/users/u1/messages");
    expect(sends[0]?.headers.Authorization).toBe("QQBot AT");
    expect(sends[0]?.body).toMatchObject({ msg_type: 0 });
    expect(sends[0]?.body.msg_id).toBeUndefined();

    await a.sendMessage({
      channel: { id: "u1", type: "dm" },
      text: "a".repeat(2100),
      replyTo: "r1",
    });
    const replies = calls.filter((c) => c.body?.msg_id === "r1");
    expect(replies.map((c) => c.body.msg_seq)).toEqual([1, 2]);

    const refused = started(
      fakeFetch((c) =>
        c.url.includes("getAppAccessToken") ? ok(c) : { code: 40054, message: "no" },
      ).fetch,
    );
    await refused.connect();
    const r = await refused.sendMessage({ channel: { id: "u1", type: "dm" }, text: "y" });
    expect(r).toMatchObject({ ok: false, error: { code: "qq_send_failed" } });
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
    expect((await a.handleWebhook(raw, "zz", String(Date.now() / 1000))).status).toBe(401);
    expect((await a.handleWebhook("not json", undefined, undefined)).status).toBe(400);
    const other = JSON.stringify({ op: 0, t: "GROUP_AT_MESSAGE_CREATE", d: {} });
    expect((await a.handleWebhook(...signed(other))).reason).toBe("not a text message");
  });

  it("answers the endpoint validation with a signature of event_ts and plain_token", async () => {
    const a = started(fakeFetch(ok).fetch);
    const raw = JSON.stringify({
      op: 13,
      d: { plain_token: "Arq0D5A61EgUu4OxUvOp", event_ts: "1725442341" },
    });
    const answer = await a.handleWebhook(raw, undefined, undefined);
    expect(answer.status).toBe(200);
    expect(answer.body?.plain_token).toBe("Arq0D5A61EgUu4OxUvOp");
    // The answer verifies as an ordinary callback signature over the same message.
    expect(
      verifyQQSignature(
        SECRET,
        "Arq0D5A61EgUu4OxUvOp",
        answer.body?.signature,
        "1725442341",
        1725442341_000,
      ),
    ).toBe(true);
    const bare = JSON.stringify({ op: 13, d: {} });
    expect((await a.handleWebhook(bare, undefined, undefined)).status).toBe(400);
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
      const sent = calls.find((c) => c.url.includes("/v2/users/u1/messages"));
      expect(sent?.body.content).toBe("pong");
    } finally {
      await runner.stop();
    }
  });

  it("splits without empty parts", () => {
    expect(splitForQQ("")).toEqual([]);
    expect(splitForQQ("a".repeat(2001))).toHaveLength(2);
  });
});
