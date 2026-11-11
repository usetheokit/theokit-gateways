import { describe, expect, it } from "vitest";

import { QQAdapter, type QQSocket, splitForQQ } from "../src/index.js";

type Listener = (event: never) => void;

class FakeSocket implements QQSocket {
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
    this.emit("close", {});
  }
  emit(type: string, event: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(event as never);
  }
  frame(f: unknown): void {
    this.emit("message", { data: JSON.stringify(f) });
  }
}

interface Call {
  url: string;
  body: Record<string, unknown> | undefined;
  auth: string | undefined;
}

function setup(over: { sendStatus?: number } = {}) {
  const calls: Call[] = [];
  const sockets: FakeSocket[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({
      url,
      body: init?.body === undefined ? undefined : JSON.parse(init.body as string),
      auth: headers?.authorization,
    });
    if (url.endsWith("getAppAccessToken")) {
      return Response.json({ access_token: "tok", expires_in: "7200" });
    }
    if (url.endsWith("/gateway")) return Response.json({ url: "wss://gw.invalid" });
    if (over.sendStatus !== undefined && over.sendStatus !== 200) {
      return new Response("nope", { status: over.sendStatus });
    }
    return Response.json({ id: `m${calls.length}` });
  }) as unknown as typeof fetch;
  const adapter = new QQAdapter({
    appId: "app",
    clientSecret: "secret",
    fetch: fetchFn,
    reconnectDelayMs: 0,
    socket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
  });
  return { adapter, calls, sockets };
}

async function connected(over?: { sendStatus?: number }) {
  const ctx = setup(over);
  const pending = ctx.adapter.connect();
  await new Promise((r) => setTimeout(r, 10));
  const socket = ctx.sockets[0]!;
  socket.frame({ op: 10, d: { heartbeat_interval: 60_000 } });
  socket.frame({ op: 0, s: 1, t: "READY", d: {} });
  expect(await pending).toBe(true);
  return { ...ctx, socket };
}

describe("QQAdapter", () => {
  it("requires its credentials", () => {
    expect(() => new QQAdapter({ appId: "", clientSecret: "s" })).toThrow(/appId/);
    expect(() => new QQAdapter({ appId: "a", clientSecret: "" })).toThrow(/clientSecret/);
  });

  it("gets a token, identifies and connects on READY", async () => {
    const { calls, socket } = await connected();
    expect(calls[0]?.body).toEqual({ appId: "app", clientSecret: "secret" });
    expect(calls[1]?.auth).toBe("QQBot tok");
    expect(socket.sent[0]).toMatchObject({ op: 2, d: { token: "QQBot tok", intents: 1 << 25 } });
  });

  it("answers false when the token endpoint refuses", async () => {
    const adapter = new QQAdapter({
      appId: "a",
      clientSecret: "s",
      fetch: (async () => new Response("", { status: 401 })) as unknown as typeof fetch,
    });
    expect(await adapter.connect()).toBe(false);
  });

  it("turns a C2C message into an event and replies to it passively", async () => {
    const { adapter, calls, socket } = await connected();
    const seen: Array<{ id: string; text: string; channel: { id: string; type: string } }> = [];
    adapter.onInbound(async (event) => {
      seen.push(event);
    });
    const d = {
      id: "in1",
      content: " hello ",
      timestamp: "2026-11-11T10:00:00+08:00",
      author: { user_openid: "U1" },
    };
    socket.frame({ op: 0, s: 2, t: "C2C_MESSAGE_CREATE", d });
    socket.frame({ op: 0, s: 3, t: "C2C_MESSAGE_CREATE", d });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ text: "hello", channel: { id: "U1", type: "dm" } });

    const result = await adapter.sendMessage({ channel: { id: "U1", type: "dm" }, text: "hi" });
    expect(result.ok).toBe(true);
    const post = calls.at(-1)!;
    expect(post.url).toBe("https://api.sgroup.qq.com/v2/users/U1/messages");
    expect(post.body).toEqual({ content: "hi", msg_type: 0, msg_id: "in1", msg_seq: 1 });
  });

  it("routes a group @ message to the group endpoint", async () => {
    const { adapter, calls, socket } = await connected();
    const seen: Array<{ channel: { id: string; type: string }; sender: { id: string } }> = [];
    adapter.onInbound(async (event) => {
      seen.push(event);
    });
    socket.frame({
      op: 0,
      t: "GROUP_AT_MESSAGE_CREATE",
      d: { id: "g1", content: " hey", group_openid: "G1", author: { member_openid: "M1" } },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(seen[0]).toMatchObject({ channel: { id: "G1", type: "group" }, sender: { id: "M1" } });
    await adapter.sendMessage({ channel: { id: "G1", type: "group" }, text: "x", replyTo: "g1" });
    expect(calls.at(-1)?.url).toBe("https://api.sgroup.qq.com/v2/groups/G1/messages");
  });

  it("splits a long reply into numbered parts", async () => {
    const { adapter, calls } = await connected();
    const result = await adapter.sendMessage({
      channel: { id: "U1", type: "dm" },
      text: "a".repeat(3200),
      replyTo: "in9",
    });
    expect(result.ok).toBe(true);
    const sends = calls.filter((c) => c.url.includes("/v2/users/"));
    expect(sends.map((c) => c.body?.msg_seq)).toEqual([1, 2, 3]);
  });

  it("reports a refusal, an empty text, attachments and a missing connection", async () => {
    const { adapter } = await connected({ sendStatus: 500 });
    const failed = await adapter.sendMessage({ channel: { id: "U1", type: "dm" }, text: "x" });
    expect(failed.error?.code).toBe("qq_send_failed");
    const empty = await adapter.sendMessage({ channel: { id: "U1", type: "dm" }, text: "" });
    expect(empty.error?.code).toBe("empty_text");
    const withFile = await adapter.sendMessage({
      channel: { id: "U1", type: "dm" },
      text: "x",
      attachments: [{} as never],
    });
    expect(withFile.error?.code).toBe("attachments_unsupported");
    const idle = await setup().adapter.sendMessage({
      channel: { id: "U1", type: "dm" },
      text: "x",
    });
    expect(idle.error?.code).toBe("not_connected");
  });

  it("closes its socket on disconnect", async () => {
    const { adapter, socket } = await connected();
    await adapter.disconnect();
    expect(socket.closed).toBe(true);
  });

  it("splits at 1500 characters", () => {
    expect(splitForQQ("")).toEqual([]);
    expect(splitForQQ("b".repeat(1501)).map((p) => p.length)).toEqual([1500, 1]);
  });
});
