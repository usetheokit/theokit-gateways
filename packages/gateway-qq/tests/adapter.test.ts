import crypto from "node:crypto";
import { GatewayRunner } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { QQAdapter, type QQFetch, signQQ, splitForQQ, verifyQQSignature } from "../src/index.js";

const SECRET = "secret";

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

const make = (f: QQFetch) => new QQAdapter({ appId: "a", appSecret: SECRET, fetch: f });

const body = (id = "m1", text = " hi", t = "C2C_MESSAGE_CREATE") =>
  JSON.stringify({
    op: 0,
    t,
    d: { id, content: text, timestamp: "2026-11-11T10:00:00+08:00", author: { user_openid: "u1" } },
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
    for (const key of ["appId", "appSecret"] as const) {
      expect(() => new QQAdapter({ appId: "a", appSecret: "s", [key]: "" })).toThrow(key);
    }
  });

  it("connects with the token exchange and fails softly", async () => {
    const { fetch, calls } = fakeFetch(ok);
    expect(await started(fetch).connect()).toBe(true);
    expect(calls[0]?.body).toEqual({ appId: "a", clientSecret: SECRET });
    expect(await started(fakeFetch(() => ({ code: 100016, message: "bad" })).fetch).connect()).toBe(
      false,
    );
    expect(await started(fakeFetch(() => "<html>").fetch).connect()).toBe(false);
    expect(await started(fakeFetch(() => ({})).fetch).connect()).toBe(false);
  });

  it("sends with the QQBot token, split, and reports a refusal", async () => {
    const { fetch, calls } = fakeFetch(ok);
    const a = started(fetch);
    await a.connect();
    const res = await a.sendMessage({ channel: { id: "u1", type: "dm" }, text: "x".repeat(4500) });
    expect(res).toEqual({ ok: true, messageId: "m1" });
    const sends = calls.filter((c) => c.url.includes("/v2/users/u1/messages"));
    expect(sends).toHaveLength(3);
    expect(sends[0]?.headers.Authorization).toBe("QQBot AT");
    expect(sends[0]?.headers["X-Union-Appid"]).toBe("a");
    expect(sends[0]?.body).toMatchObject({ msg_type: 0 });
    expect(sends[0]?.body.msg_id).toBeUndefined();

    const refused = started(
      fakeFetch((c) => (c.url.includes("getApp") ? ok(c) : { code: 304003, message: "no" })).fetch,
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
    expect((await a.handleWebhook(raw, "zz", String(Math.floor(Date.now() / 1000)))).status).toBe(
      401,
    );
    expect((await a.handleWebhook("not json", undefined, undefined)).status).toBe(400);
    expect(
      (await a.handleWebhook(...signed(body("m3", "x", "GROUP_AT_MESSAGE_CREATE")))).reason,
    ).toBe("not a direct text message");
  });

  it("answers the callback URL validation with a signature QQ can check", async () => {
    const a = started(fakeFetch(ok).fetch);
    const raw = JSON.stringify({
      op: 13,
      d: { plain_token: "Arq0D5A61EgUu4OxUvOp", event_ts: "1725442341" },
    });
    const answer = await a.handleWebhook(raw, undefined, undefined);
    expect(answer.status).toBe(200);
    expect(answer.body?.plain_token).toBe("Arq0D5A61EgUu4OxUvOp");
    const seed = "secretsecretsecretsecretsecretse";
    const key = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(seed),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const expected = crypto.sign(null, Buffer.from("1725442341Arq0D5A61EgUu4OxUvOp"), key);
    expect(answer.body?.signature).toBe(expected.toString("hex"));
    expect(
      (await a.handleWebhook(JSON.stringify({ op: 13, d: {} }), undefined, undefined)).status,
    ).toBe(400);
  });

  it("refuses a validation whose plain_token holds an event body", async () => {
    const a = started(fakeFetch(ok).fetch);
    const seen: string[] = [];
    a.onInbound(async (e) => void seen.push(e.text));
    const now = String(Math.floor(Date.now() / 1000));
    const eventBody = body("msg-1", "hello");

    const validation = await a.handleWebhook(
      JSON.stringify({ op: 13, d: { event_ts: now, plain_token: eventBody } }),
      undefined,
      undefined,
    );
    const event = await a.handleWebhook(eventBody, validation.body?.signature, now);

    expect(seen).toEqual([]);
    expect(event.status).toBe(401);
    expect(validation.status).toBe(400);
    expect(validation.body).toBeUndefined();
  });

  it("refuses a validation whose event_ts holds an event body", async () => {
    const a = started(fakeFetch(ok).fetch);
    const seen: string[] = [];
    a.onInbound(async (e) => void seen.push(e.text));
    const now = String(Math.floor(Date.now() / 1000));
    const eventBody = body("msg-2", "hello");

    const validation = await a.handleWebhook(
      JSON.stringify({ op: 13, d: { event_ts: now + eventBody, plain_token: " " } }),
      undefined,
      undefined,
    );
    const event = await a.handleWebhook(`${eventBody} `, validation.body?.signature, now);

    expect(seen).toEqual([]);
    expect(event.status).toBe(401);
    expect(validation.status).toBe(400);
  });

  it("refuses validation fields outside the token and timestamp shapes", async () => {
    const a = started(fakeFetch(ok).fetch);
    const validate = (d: Record<string, unknown>) =>
      a.handleWebhook(JSON.stringify({ op: 13, d }), undefined, undefined);
    const ts = "1725442341";
    for (const plain_token of ["", " ", "a b", "{}", '"x"', "a".repeat(129), 42]) {
      expect((await validate({ plain_token, event_ts: ts })).status).toBe(400);
    }
    for (const event_ts of ["", "17254a", " 1725442341", "1.7e9", "1".repeat(21), 1725442341]) {
      expect((await validate({ plain_token: "Arq0D5A61EgUu4OxUvOp", event_ts })).status).toBe(400);
    }
    for (const plain_token of ["Arq0D5A61EgUu4OxUvOp", "a", "a".repeat(128), "aZ09_-+/="]) {
      const answer = await validate({ plain_token, event_ts: ts });
      expect(answer.status).toBe(200);
      expect(answer.body?.signature).toBe(signQQ(SECRET, ts + plain_token));
    }
  });

  it("rejects a signature from another secret", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifyQQSignature(SECRET, "b", signQQ("other", `${ts}b`), ts)).toBe(false);
    expect(verifyQQSignature(SECRET, "b", signQQ(SECRET, `${ts}b`), ts)).toBe(true);
  });

  it("answers 400 to a JSON body that is not an object", async () => {
    const a = started(fakeFetch(ok).fetch);
    const seen: string[] = [];
    a.onInbound(async (e) => void seen.push(e.text));
    for (const raw of ["null", "42", '"text"', "[]", "[{}]", "true"]) {
      const answer = await a.handleWebhook(raw, undefined, undefined);
      expect(answer.status).toBe(400);
      expect(answer.body).toBeUndefined();
    }
    expect(seen).toEqual([]);
  });

  it("acknowledges a throwing handler", async () => {
    const a = started(fakeFetch(ok).fetch);
    a.onInbound(async () => {
      throw new Error("boom");
    });
    expect((await a.handleWebhook(...signed(body("m9")))).reason).toBe("handler_threw");
  });

  it("answers through GatewayRunner as a passive reply", async () => {
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
      const sent = calls.find((c) => c.url.includes("/messages"));
      expect(sent?.body).toMatchObject({ content: "pong", msg_id: "m5", msg_seq: 1 });
      await a.sendMessage({ channel: { id: "u1", type: "dm" }, text: "again" });
      const last = calls.at(-1);
      expect(last?.body).toMatchObject({ msg_id: "m5", msg_seq: 2 });
    } finally {
      await runner.stop();
    }
  });

  it("splits without empty parts", () => {
    expect(splitForQQ("")).toEqual([]);
    expect(splitForQQ("a".repeat(2001))).toHaveLength(2);
  });
});
