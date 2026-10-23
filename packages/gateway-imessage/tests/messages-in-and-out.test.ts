import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IMessageAdapter } from "../src/index.js";
import { type FakeChild, fakeSpawn, until } from "./fake-child.js";

async function connected(): Promise<{ adapter: IMessageAdapter; child: FakeChild }> {
  const fake = fakeSpawn();
  const adapter = new IMessageAdapter({ spawn: fake.spawn });
  const connecting = adapter.connect();
  await until(() => fake.children[0]?.last("watch.subscribe") !== undefined, "subscribe");
  const child = fake.children[0] as FakeChild;
  child.answer((child.last("watch.subscribe") as { id: number }).id, { subscription: 1 });
  expect(await connecting).toBe(true);
  return { adapter, child };
}

function received(adapter: IMessageAdapter): MessageEvent[] {
  const events: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    events.push(event);
  });
  return events;
}

/** Start a send and wait until its request line reached the child. */
async function sendStarted(adapter: IMessageAdapter, child: FakeChild, text = "hello") {
  const before = child.written.filter((r) => r.method === "send").length;
  const sending = adapter.sendMessage({ channel: { id: "7", type: "dm" }, text });
  await until(
    () => child.written.filter((r) => r.method === "send").length > before,
    "send request",
  );
  return { sending, request: child.last("send") as { id: number; params: unknown } };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("inbound", () => {
  it("turns a message notification into an IMessageMessageEvent", async () => {
    const { adapter, child } = await connected();
    const events = received(adapter);

    child.message({
      id: 41,
      chat_id: 9,
      guid: "p:0/ABC",
      sender: "ana@example.com",
      text: "hi there",
      is_group: true,
      participants: ["ana@example.com", "+5511977776666"],
    });
    await until(() => events.length === 1, "one event");

    const event = events[0] as MessageEvent;
    if (event.platform !== "imessage") throw new Error(`platform ${event.platform}`);
    expect(event.id).toBe("p:0/ABC");
    expect(event.text).toBe("hi there");
    expect(event.sender).toEqual({ id: "ana@example.com" });
    expect(event.channel).toEqual({ id: "9", type: "group" });
    expect(event.imessage.chatId).toBe(9);
    expect(event.imessage.isGroup).toBe(true);
    expect(event.imessage.participants).toEqual(["ana@example.com", "+5511977776666"]);
  });

  it("files a one-to-one chat as a dm", async () => {
    const { adapter, child } = await connected();
    const events = received(adapter);

    child.message({ id: 1, chat_id: 3, is_group: false });
    await until(() => events.length === 1, "one event");

    expect(events[0]?.channel).toEqual({ id: "3", type: "dm" });
  });

  it("drops its own replies", async () => {
    const { adapter, child } = await connected();
    const events = received(adapter);

    child.message({ id: 1, is_from_me: true, text: "my own reply" });
    child.message({ id: 2, is_from_me: false, text: "from the peer" });
    await until(() => events.length === 1, "the peer's message");
    await new Promise((resolve) => setImmediate(resolve));

    expect(events.map((e) => e.text)).toEqual(["from the peer"]);
  });

  it("drops a message with no text", async () => {
    const { adapter, child } = await connected();
    const events = received(adapter);

    child.message({ id: 1, text: "" });
    child.message({ id: 2, text: "after the attachment" });
    await until(() => events.length === 1, "the text message");

    expect(events[0]?.text).toBe("after the attachment");
  });

  it("a stdout line that is not JSON is skipped", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, child } = await connected();
    const events = received(adapter);

    child.emitLine("imsg: warming up the database");
    child.message({ id: 5, text: "still delivered" });
    await until(() => events.length === 1, "the message after the noise");

    expect(events[0]?.text).toBe("still delivered");
  });

  it("delivers a burst in row order, without its own rows", async () => {
    const { adapter, child } = await connected();
    const order: number[] = [];
    adapter.onInbound(async (event) => {
      if (event.platform !== "imessage") return;
      await new Promise((resolve) => setImmediate(resolve));
      order.push(Number(event.text.split(" ")[1]));
    });

    for (let row = 1; row <= 100; row += 1) {
      child.message({ id: row, is_from_me: row % 2 === 0, text: `row ${row}` });
    }
    await until(() => order.length === 50, "fifty peer rows", 5000);

    expect(order).toEqual(Array.from({ length: 50 }, (_, i) => i * 2 + 1));
  });

  it("deliver() hands an out-of-band event to the handler", async () => {
    const { adapter } = await connected();
    const events = received(adapter);
    const event: MessageEvent = {
      id: "g-1",
      platform: "imessage",
      sender: { id: "+5511988887777" },
      channel: { id: "7", type: "dm" },
      text: "replayed",
      receivedAt: 0,
      imessage: { chatId: 7, guid: "g-1", isGroup: false, participants: [], raw: {} },
    };

    await expect(adapter.deliver(event)).resolves.toBe("ok");
    expect(events).toEqual([event]);
  });
});

describe("outbound", () => {
  it("sends to the chat id and returns the message guid", async () => {
    const { adapter, child } = await connected();

    const { sending, request } = await sendStarted(adapter, child);
    expect(request.params).toEqual({ chat_id: 7, text: "hello" });
    child.answer(request.id, { ok: true, guid: "p:0/OUT-1", id: 99 });

    await expect(sending).resolves.toEqual({ ok: true, messageId: "p:0/OUT-1" });
  });

  it("falls back to the numeric row id when there is no guid", async () => {
    const { adapter, child } = await connected();

    const { sending, request } = await sendStarted(adapter, child);
    child.answer(request.id, { ok: true, id: 99 });

    await expect(sending).resolves.toEqual({ ok: true, messageId: "99" });
  });

  it("a send answered with ok alone has no messageId", async () => {
    const { adapter, child } = await connected();

    const { sending, request } = await sendStarted(adapter, child);
    child.answer(request.id, { ok: true });
    const result = await sending;

    expect(result).toEqual({ ok: true });
    expect(result).not.toHaveProperty("messageId");
    expect(JSON.stringify(result)).not.toContain("undefined");
  });

  it("refuses a chat id that is not a positive integer", async () => {
    const { adapter, child } = await connected();

    for (const id of ["abc", "0", "-3", "1.5", "", "7x", "007"]) {
      const result = await adapter.sendMessage({ channel: { id, type: "dm" }, text: "hi" });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("invalid_chat_id");
    }
    expect(child.last("send")).toBeUndefined();
  });

  it("refuses empty text before anything else", async () => {
    const adapter = new IMessageAdapter({ spawn: fakeSpawn().spawn });

    const result = await adapter.sendMessage({ channel: { id: "7", type: "dm" }, text: "" });

    expect(result.error?.code).toBe("empty_text");
  });

  it("refuses a send before connect", async () => {
    const adapter = new IMessageAdapter({ spawn: fakeSpawn().spawn });

    const result = await adapter.sendMessage({ channel: { id: "7", type: "dm" }, text: "hi" });

    expect(result.error?.code).toBe("not_connected");
  });

  it("strips markdown markers before sending", async () => {
    const { adapter, child } = await connected();

    const sending = adapter.sendMessage({
      channel: { id: "7", type: "dm" },
      text: "**Hi** _group_",
      format: "markdown",
    });
    await until(() => child.last("send") !== undefined, "send");
    const request = child.last("send") as { id: number; params?: Record<string, unknown> };
    child.answer(request.id, { ok: true, guid: "g" });
    await sending;

    expect(request.params?.text).toBe("Hi group");
  });

  it("sends html unchanged and warns once", async () => {
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, child } = await connected();

    for (const text of ["<b>one</b>", "<b>two</b>"]) {
      const sending = adapter.sendMessage({
        channel: { id: "7", type: "dm" },
        text,
        format: "html",
      });
      await until(() => (child.last("send")?.params as { text?: string })?.text === text, text);
      child.answer((child.last("send") as { id: number }).id, { ok: true, guid: text });
      await sending;
    }

    const warnings = warn.mock.calls.filter((call) => String(call[0]).includes("html"));
    expect(warnings).toHaveLength(1);
  });

  it("matches each answer to its own request when two sends are in flight", async () => {
    const { adapter, child } = await connected();

    const first = await sendStarted(adapter, child, "first");
    const second = await sendStarted(adapter, child, "second");
    child.answer(second.request.id, { ok: true, guid: "g-second" });
    child.answer(first.request.id, { ok: true, guid: "g-first" });

    await expect(Promise.all([first.sending, second.sending])).resolves.toEqual([
      { ok: true, messageId: "g-first" },
      { ok: true, messageId: "g-second" },
    ]);
  });

  it("times out a send nobody answers", async () => {
    vi.useFakeTimers();
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn, requestTimeoutMs: 1_000 });
    const connecting = adapter.connect();
    await vi.advanceTimersByTimeAsync(0);
    const child = fake.children[0] as FakeChild;
    child.answer((child.last("watch.subscribe") as { id: number }).id, { subscription: 1 });
    await connecting;

    const sending = adapter.sendMessage({ channel: { id: "7", type: "dm" }, text: "hi" });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(sending).resolves.toMatchObject({ ok: false, error: { code: "timeout" } });
  });
});
