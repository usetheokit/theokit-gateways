import { GatewayRunner } from "@theokit/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { QQAdapter, type QQFetch, type QQSocket, splitForQQ } from "../src/index.js";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

function fakeFetch(answer: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch: QQFetch = async (url, init) => {
    const call = {
      method: init.method,
      url,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const out = answer(call);
    return { status: out.status ?? 200, text: async () => JSON.stringify(out.body) };
  };
  return { fetch, calls };
}

const okApi = (c: Call): { status?: number; body: unknown } => {
  if (c.url.endsWith("/getAppAccessToken")) {
    return { body: { access_token: "AT", expires_in: "7200" } };
  }
  if (c.url.endsWith("/gateway")) return { body: { url: "wss://gw.example/ws" } };
  return { body: { id: "out-1", timestamp: "t" } };
};

class FakeSocket implements QQSocket {
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const tick = () => new Promise((r) => setTimeout(r, 10));

function make(
  api: (c: Call) => { status?: number; body: unknown } = okApi,
  connectTimeoutMs = 2000,
) {
  const f = fakeFetch(api);
  const sockets: FakeSocket[] = [];
  const adapter = new QQAdapter({
    appId: "app1",
    clientSecret: "sec",
    fetch: f.fetch,
    connectTimeoutMs,
    socketFactory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
  });
  return { adapter, calls: f.calls, sockets };
}

/** Connect and have the fake gateway say hello and READY. */
async function connected(m: ReturnType<typeof make>) {
  const p = m.adapter.connect();
  await tick();
  const sock = m.sockets[0] as FakeSocket;
  sock.push({ op: 10, d: { heartbeat_interval: 60_000 } });
  await tick();
  sock.push({ op: 0, s: 1, t: "READY", d: { session_id: "S1" } });
  expect(await p).toBe(true);
  return sock;
}

const c2c = {
  op: 0,
  s: 2,
  t: "C2C_MESSAGE_CREATE",
  d: {
    id: "m1",
    content: " hi 你好",
    timestamp: "2026-11-11T00:00:00+08:00",
    author: { user_openid: "U1" },
  },
};

let adapters: QQAdapter[] = [];
afterEach(async () => {
  await Promise.all(adapters.map((a) => a.disconnect()));
  adapters = [];
});

describe("construction", () => {
  it("rejects a missing credential", () => {
    expect(() => new QQAdapter({ appId: "", clientSecret: "s" })).toThrow(/appId/);
    expect(() => new QQAdapter({ appId: "a", clientSecret: "" })).toThrow(/clientSecret/);
  });
});

describe("connect", () => {
  it("identifies with the QQBot token and intents, true on READY", async () => {
    const m = make();
    adapters.push(m.adapter);
    const sock = await connected(m);
    expect(sock.sent[0]).toMatchObject({
      op: 2,
      d: { token: "QQBot AT", intents: 1 << 25, shard: [0, 1] },
    });
    expect(m.calls[0]?.body).toEqual({ appId: "app1", clientSecret: "sec" });
    expect(m.calls[1]?.headers.Authorization).toBe("QQBot AT");
  });

  it("is false when the token endpoint refuses", async () => {
    const m = make(() => ({ status: 400, body: { code: 100007, message: "bad" } }));
    adapters.push(m.adapter);
    expect(await m.adapter.connect()).toBe(false);
  });

  it("is false when READY never comes", async () => {
    const m = make(okApi, 50);
    adapters.push(m.adapter);
    expect(await m.adapter.connect()).toBe(false);
    expect(m.sockets[0]?.closed).toBe(true);
  });
});

describe("inbound and reply", () => {
  it("routes a C2C message through GatewayRunner and replies as a passive reply", async () => {
    const m = make();
    adapters.push(m.adapter);
    const runner = new GatewayRunner({
      adapters: [m.adapter],
      handler: async (_e, ctx) => {
        await ctx.reply("pong");
      },
    });
    const started = runner.start();
    await tick();
    const sock = m.sockets[0] as FakeSocket;
    sock.push({ op: 10, d: { heartbeat_interval: 60_000 } });
    await tick();
    sock.push({ op: 0, s: 1, t: "READY", d: { session_id: "S1" } });
    await started;
    sock.push(c2c);
    await new Promise((r) => setTimeout(r, 50));
    const send = m.calls.find((c) => c.url.includes("/v2/users/U1/messages"));
    expect(send?.body).toEqual({ content: "pong", msg_type: 0, msg_id: "m1", msg_seq: 1 });
    await runner.stop();
  });

  it("builds a group event and sends to the group endpoint with a rising msg_seq", async () => {
    const m = make();
    adapters.push(m.adapter);
    const events: unknown[] = [];
    m.adapter.onInbound(async (e) => {
      events.push(e);
    });
    const sock = await connected(m);
    sock.push({
      op: 0,
      s: 3,
      t: "GROUP_AT_MESSAGE_CREATE",
      d: { id: "g1", content: " ask", group_openid: "G1", author: { member_openid: "M1" } },
    });
    sock.push(c2c);
    sock.push(c2c); // a repeat
    await tick();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      platform: "qq",
      sender: { id: "M1" },
      channel: { id: "G1", type: "group" },
      text: "ask",
    });
    const channel = { id: "G1", type: "group" as const };
    await m.adapter.sendMessage({ channel, text: "a" });
    const r = await m.adapter.sendMessage({ channel, text: "b" });
    expect(r).toEqual({ ok: true, messageId: "out-1" });
    const sends = m.calls.filter((c) => c.url.includes("/v2/groups/G1/messages"));
    expect(sends.map((s) => s.body?.msg_seq)).toEqual([1, 2]);
  });

  it("answers the heartbeat and resumes after a reconnect request", async () => {
    const m = make();
    adapters.push(m.adapter);
    const sock = await connected(m);
    sock.push({ op: 7 });
    expect(sock.closed).toBe(true);
  });

  it("reports QQ's error code", async () => {
    const m = make((c) =>
      c.url.includes("/messages")
        ? { status: 400, body: { code: 304023, message: "msg_id expired" } }
        : okApi(c),
    );
    adapters.push(m.adapter);
    await connected(m);
    const r = await m.adapter.sendMessage({ channel: { id: "U1", type: "dm" }, text: "x" });
    expect(r.error?.code).toBe("qq_send_failed");
    expect(r.error?.message).toContain("304023");
  });
});

describe("sendMessage refusals", () => {
  it("refuses before connect, empty text, empty channel and attachments", async () => {
    const m = make();
    const ch = { id: "U1", type: "dm" as const };
    expect((await m.adapter.sendMessage({ channel: ch, text: "x" })).error?.code).toBe(
      "not_connected",
    );
    expect((await m.adapter.sendMessage({ channel: ch, text: "" })).error?.code).toBe("empty_text");
    expect(
      (
        await m.adapter.sendMessage({
          channel: ch,
          text: "x",
          attachments: [{ kind: "image", data: new Uint8Array(1), mimeType: "image/png" }] as never,
        })
      ).error?.code,
    ).toBe("attachments_unsupported");
    adapters.push(m.adapter);
    await connected(m);
    expect(
      (await m.adapter.sendMessage({ channel: { id: "", type: "dm" }, text: "x" })).error?.code,
    ).toBe("invalid_channel");
  });
});

describe("splitForQQ", () => {
  it("splits long text and returns nothing for empty", () => {
    expect(splitForQQ("")).toEqual([]);
    expect(splitForQQ("a".repeat(3100)).length).toBe(3);
  });
});
