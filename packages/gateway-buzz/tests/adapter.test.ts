import type { MessageEvent as GatewayMessageEvent } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { BuzzAdapter, splitForBuzz } from "../src/index.js";
import { FakeSocket, fakeFetch, message } from "./fakes.js";

function make(extra: Record<string, unknown> = {}) {
  const sockets: FakeSocket[] = [];
  const f = fakeFetch();
  const adapter = new BuzzAdapter({
    baseUrl: "https://chat.test/",
    token: "bz_secret",
    workspaceId: "w1",
    botUserId: "bot1",
    fetch: f.fn,
    reconnectDelayMs: 0,
    socket: (url, headers) => {
      const s = new FakeSocket(url, headers);
      sockets.push(s);
      return s;
    },
    ...extra,
  });
  return { adapter, sockets, calls: f.calls };
}

async function connected(extra: Record<string, unknown> = {}) {
  const made = make(extra);
  const pending = made.adapter.connect();
  made.sockets[0]?.open();
  expect(await pending).toBe(true);
  const events: GatewayMessageEvent[] = [];
  made.adapter.onInbound(async (e) => {
    events.push(e);
  });
  return { ...made, events, socket: made.sockets[0] as FakeSocket };
}

describe("BuzzAdapter", () => {
  it("names the platform and requires its options", () => {
    expect(make().adapter.platform).toBe("buzz");
    expect(
      () => new BuzzAdapter({ baseUrl: "x", token: "", workspaceId: "w", botUserId: "b" }),
    ).toThrow(/token/);
  });

  it("opens the realtime socket with the workspace and bearer token, once", async () => {
    const { adapter, sockets, socket } = await connected();
    expect(await adapter.connect()).toBe(true);
    expect(sockets).toHaveLength(1);
    expect(socket.url).toBe("wss://chat.test/api/realtime/ws?workspace_id=w1");
    expect(socket.headers.authorization).toBe("Bearer bz_secret");
  });

  it("answers false, not a throw, when the socket errors or the factory throws", async () => {
    const a = make();
    const pending = a.adapter.connect();
    a.sockets[0]?.drop();
    expect(await pending).toBe(false);
    const b = make({
      socket: () => {
        throw new Error("no ws");
      },
    });
    expect(await b.adapter.connect()).toBe(false);
  });

  it("does not report connected when disconnect() overtakes the open", async () => {
    const { adapter, sockets } = make();
    const pending = adapter.connect();
    await adapter.disconnect();
    sockets[0]?.open();
    expect(await pending).toBe(false);
    expect(sockets[0]?.closed).toBeGreaterThan(0);
  });

  it("turns a message.created into an event; skips own, repeated and bodiless messages", async () => {
    const { socket, events } = await connected();
    socket.frame(message());
    socket.frame(message());
    socket.frame(message({ id: "m2", author_user_id: "bot1" }));
    socket.frame(message({ id: "m3", body: undefined }));
    socket.frame({ type: "typing", cursor: "6" });
    socket.frame("not json");
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "m1",
      platform: "buzz",
      sender: { id: "u1", username: "Ana" },
      channel: { id: "ch1", type: "group" },
      text: "hello",
      buzz: {
        messageId: "m1",
        channelId: "ch1",
        workspaceId: "w1",
        threadId: "",
        cursor: "5",
      },
    });
  });

  it("marks a direct channel as dm", async () => {
    const { socket, events } = await connected();
    socket.frame(message({ channel_type: "dm" }));
    expect(events[0]?.channel.type).toBe("dm");
  });

  it("reopens a dropped socket from the last cursor, and from now after resync_required", async () => {
    const { adapter, sockets, socket } = await connected({ reconnectDelayMs: 5 });
    socket.frame(message({}, "42"));
    socket.drop();
    await new Promise((r) => setTimeout(r, 30));
    expect(sockets[1]?.url).toContain("after_cursor=42");
    sockets[1]?.open();
    await new Promise((r) => setTimeout(r, 5));
    sockets[1]?.frame({ type: "resync_required" });
    await new Promise((r) => setTimeout(r, 30));
    expect(sockets[2]?.url).not.toContain("after_cursor");
    await adapter.disconnect();
  });

  it("keeps one pending retry when a reconnect socket fails", async () => {
    const { adapter, sockets, socket } = await connected({ reconnectDelayMs: 10 });
    socket.drop();
    await new Promise((r) => setTimeout(r, 25));
    expect(sockets).toHaveLength(2);
    sockets[1]?.drop(); // close event and the failed result both ask for a retry
    await new Promise((r) => setTimeout(r, 25));
    expect(sockets).toHaveLength(3);
    await adapter.disconnect();
  });

  it("posts a reply with the bearer token and returns its id", async () => {
    const { adapter, calls } = await connected();
    const result = await adapter.sendMessage({ channel: { id: "ch1", type: "group" }, text: "hi" });
    expect(result).toEqual({ ok: true, messageId: "sent-1" });
    expect(calls[0]?.url).toBe("https://chat.test/api/channels/ch1/messages");
    expect(calls[0]?.headers.authorization).toBe("Bearer bz_secret");
    expect(calls[0]?.body.body).toBe("hi");
  });

  it("splits a long reply in order and strips markdown markers", async () => {
    const { adapter, calls } = await connected();
    await adapter.sendMessage({ channel: { id: "ch1", type: "group" }, text: "a".repeat(4001) });
    expect(calls.map((c) => c.body.body.length)).toEqual([4000, 1]);
    await adapter.sendMessage({
      channel: { id: "ch1", type: "group" },
      text: "**bold**",
      format: "markdown",
    });
    expect(calls[2]?.body.body).toBe("bold");
    expect(splitForBuzz("")).toEqual([]);
  });

  it("refuses without calling the server: attachments, empty text, not connected, bad channel", async () => {
    const off = make();
    const out = { channel: { id: "ch1", type: "group" as const }, text: "x" };
    expect((await off.adapter.sendMessage(out)).error?.code).toBe("not_connected");
    const { adapter, calls } = await connected();
    const code = async (o: Parameters<typeof adapter.sendMessage>[0]) =>
      (await adapter.sendMessage(o)).error?.code;
    expect(await code({ ...out, text: "" })).toBe("empty_text");
    expect(await code({ ...out, channel: { id: "", type: "group" } })).toBe("invalid_channel");
    expect(
      await code({
        ...out,
        attachments: [{ kind: "image", data: new Uint8Array(1), mimeType: "image/png" } as never],
      }),
    ).toBe("attachments_unsupported");
    expect(calls).toHaveLength(0);
  });

  it("reports a refused post as buzz_send_failed, not a throw", async () => {
    const failing = fakeFetch(403);
    const { adapter } = await connected({ fetch: failing.fn });
    const result = await adapter.sendMessage({ channel: { id: "ch1", type: "group" }, text: "x" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "buzz_send_failed" });
    expect(result.error?.message).toContain("403");
  });

  it("deliver() reports the handler outcome and onInbound replaces the handler", async () => {
    const { adapter } = make();
    const event = { id: "e", platform: "buzz" } as unknown as GatewayMessageEvent;
    expect(await adapter.deliver(event)).toBe("no_handler");
    adapter.onInbound(async () => {
      throw new Error("boom");
    });
    expect(await adapter.deliver(event)).toBe("handler_threw");
    const off = adapter.onInbound(async () => undefined);
    expect(await adapter.deliver(event)).toBe("ok");
    off();
    expect(await adapter.deliver(event)).toBe("no_handler");
  });
});
