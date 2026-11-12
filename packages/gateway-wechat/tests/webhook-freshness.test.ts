import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeWeChatSignature, WeChatAdapter, type WeChatFetch } from "../src/index.js";
import { NonceMemory } from "../src/nonce-memory.js";

const TOKEN = "tok";
const NOW_S = 1_800_000_000;

const noFetch: WeChatFetch = async () => ({ status: 200, text: async () => "{}" });

function signed(timestamp: number, nonce: string) {
  const ts = String(timestamp);
  return { timestamp: ts, nonce, signature: computeWeChatSignature(TOKEN, ts, nonce) };
}

function textXml(msgId: string, from: string, content: string): string {
  return `<xml><ToUserName><![CDATA[gh_1]]></ToUserName><FromUserName><![CDATA[${from}]]></FromUserName><CreateTime>${NOW_S}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content}]]></Content><MsgId>${msgId}</MsgId></xml>`;
}

function listening() {
  const adapter = new WeChatAdapter({
    appId: "wx1",
    appSecret: "sec",
    token: TOKEN,
    fetch: noFetch,
  });
  const seen: { id: string; sender: string; text: string }[] = [];
  adapter.onInbound(async (e) => void seen.push({ id: e.id, sender: e.sender.id, text: e.text }));
  return { adapter, seen };
}

describe("plain-mode webhook freshness", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_S * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a freshly signed message", async () => {
    const { adapter, seen } = listening();
    const answer = await adapter.handleWebhook(signed(NOW_S, "fresh"), textXml("1", "o1", "hi"));
    expect(answer).toMatchObject({ status: 200, body: "success" });
    expect(seen).toEqual([{ id: "1", sender: "o1", text: "hi" }]);
  });

  it("refuses a signed query string sent again with another body", async () => {
    const { adapter, seen } = listening();
    const query = signed(NOW_S, "n-once");
    expect((await adapter.handleWebhook(query, textXml("1", "o1", "hi"))).status).toBe(200);
    const second = await adapter.handleWebhook(query, textXml("2", "o2", "other"));
    expect(second).toMatchObject({ status: 401, reason: "nonce reused" });
    expect(seen).toEqual([{ id: "1", sender: "o1", text: "hi" }]);
  });

  it("lets the platform retry the same request without dispatching it twice", async () => {
    const { adapter, seen } = listening();
    const query = signed(NOW_S, "retried");
    const body = textXml("1", "o1", "hi");
    expect((await adapter.handleWebhook(query, body)).status).toBe(200);
    expect(await adapter.handleWebhook(query, body)).toMatchObject({
      status: 200,
      reason: "duplicate",
    });
    expect(seen).toHaveLength(1);
  });

  it("delivers a retry that follows a 503", async () => {
    const adapter = new WeChatAdapter({
      appId: "wx1",
      appSecret: "s",
      token: TOKEN,
      fetch: noFetch,
    });
    const query = signed(NOW_S, "after-503");
    const body = textXml("1", "o1", "hi");
    expect((await adapter.handleWebhook(query, body)).status).toBe(503);
    const seen: string[] = [];
    adapter.onInbound(async (e) => void seen.push(e.id));
    expect((await adapter.handleWebhook(query, body)).status).toBe(200);
    expect(seen).toEqual(["1"]);
  });

  it("refuses a stale timestamp, on a message and on the verification GET", async () => {
    const { adapter, seen } = listening();
    const stale = signed(NOW_S - 3600, "old");
    expect(await adapter.handleWebhook(stale, textXml("1", "o1", "hi"))).toMatchObject({
      status: 401,
      reason: "stale timestamp",
    });
    expect((await adapter.handleWebhook({ ...stale, echostr: "E" })).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it("refuses a timestamp that is not a whole number of seconds", async () => {
    const { adapter } = listening();
    for (const ts of ["abc", "1800000000.5", "", "-1"]) {
      const query = {
        timestamp: ts,
        nonce: "n",
        signature: computeWeChatSignature(TOKEN, ts, "n"),
      };
      expect((await adapter.handleWebhook(query, textXml("1", "o1", "hi"))).status).toBe(401);
    }
  });

  it("accepts a clock skew of exactly 300 seconds either way and refuses 301", async () => {
    const { adapter, seen } = listening();
    const at = async (offset: number, nonce: string, msgId: string) =>
      (await adapter.handleWebhook(signed(NOW_S + offset, nonce), textXml(msgId, "o1", nonce)))
        .status;
    expect(await at(-300, "past-edge", "1")).toBe(200);
    expect(await at(300, "future-edge", "2")).toBe(200);
    expect(await at(-301, "past-out", "3")).toBe(401);
    expect(await at(301, "future-out", "4")).toBe(401);
    expect(seen.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("forgets a nonce once its timestamp can no longer pass", async () => {
    const { adapter } = listening();
    const query = signed(NOW_S, "reused-later");
    expect((await adapter.handleWebhook(query, textXml("1", "o1", "a"))).status).toBe(200);
    vi.setSystemTime((NOW_S + 301) * 1000);
    // The old query is now stale, so the nonce memory is no longer what refuses it.
    expect((await adapter.handleWebhook(query, textXml("2", "o1", "b"))).reason).toBe(
      "stale timestamp",
    );
    // The same nonce under a new timestamp is a different signed request.
    const later = signed(NOW_S + 301, "reused-later");
    expect((await adapter.handleWebhook(later, textXml("3", "o1", "c"))).status).toBe(200);
  });
});

describe("NonceMemory", () => {
  it("holds at most its limit, forgetting the oldest first", () => {
    const memory = new NonceMemory(2);
    expect(memory.admit("1", "a", "x", 0)).toBe(true);
    expect(memory.admit("1", "b", "x", 0)).toBe(true);
    expect(memory.admit("1", "c", "x", 0)).toBe(true);
    // "a" was evicted, so another body under it is no longer recognised; "c" still is.
    expect(memory.admit("1", "a", "y", 0)).toBe(true);
    expect(memory.admit("1", "c", "y", 0)).toBe(false);
  });
});
