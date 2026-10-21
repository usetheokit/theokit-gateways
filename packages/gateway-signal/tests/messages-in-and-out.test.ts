import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignalAdapter, type SignalAdapterOptions } from "../src/index.js";
import { type FakeChild, fakeSpawn, until } from "./fake-child.js";

const ACCOUNT = "+5511999990000";

async function connected(
  opts: Partial<SignalAdapterOptions> = {},
): Promise<{ adapter: SignalAdapter; child: FakeChild }> {
  const fake = fakeSpawn();
  const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fake.spawn, ...opts });
  const connecting = adapter.connect();
  await until(() => fake.children[0]?.last("listGroups") !== undefined, "listGroups");
  const child = fake.children[0] as FakeChild;
  child.answer((child.last("listGroups") as { id: number }).id, []);
  expect(await connecting).toBe(true);
  return { adapter, child };
}

function received(adapter: SignalAdapter): MessageEvent[] {
  const events: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    events.push(event);
  });
  return events;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("inbound", () => {
  it("turns a receive notification into a SignalMessageEvent", async () => {
    const { adapter, child } = await connected();
    const events = received(adapter);

    child.receive({
      source: "+5511988887777",
      sourceNumber: "+5511988887777",
      sourceUuid: "uuid-ana",
      sourceName: "Ana",
      timestamp: 1_700_000_000_123,
      dataMessage: {
        timestamp: 1_700_000_000_123,
        message: "hi there",
        groupInfo: { groupId: "Z3JvdXA=" },
      },
    });
    await until(() => events.length === 1, "one event");

    const event = events[0] as MessageEvent;
    if (event.platform !== "signal") throw new Error(`platform ${event.platform}`);
    expect(event.id).toBe("uuid-ana:1700000000123");
    expect(event.text).toBe("hi there");
    expect(event.sender).toEqual({ id: "uuid-ana", displayName: "Ana" });
    expect(event.channel).toEqual({ id: "group.Z3JvdXA=", type: "group" });
    expect(event.signal.timestamp).toBe(1_700_000_000_123);
    expect(event.signal.groupId).toBe("Z3JvdXA=");
    expect(event.signal.sourceNumber).toBe("+5511988887777");
  });

  it("files a direct message under the sender's number", async () => {
    const { adapter, child } = await connected();
    const events = received(adapter);

    child.receive({
      sourceNumber: "+5511988887777",
      sourceUuid: "uuid-ana",
      timestamp: 5,
      dataMessage: { timestamp: 5, message: "hello" },
    });
    await until(() => events.length === 1, "one event");

    expect(events[0]?.channel).toEqual({ id: "+5511988887777", type: "dm" });
  });

  it("ignores a receipt envelope", async () => {
    const { adapter, child } = await connected();
    const events = received(adapter);

    child.receive({ sourceUuid: "uuid-ana", timestamp: 6, receiptMessage: { isDelivery: true } });
    child.receive({
      sourceUuid: "uuid-ana",
      timestamp: 7,
      dataMessage: { timestamp: 7, message: "" },
    });
    child.receive({
      sourceUuid: "uuid-ana",
      timestamp: 8,
      dataMessage: { timestamp: 8, message: "x" },
    });
    await until(() => events.length === 1, "the one text message");

    expect(events.map((e) => e.text)).toEqual(["x"]);
  });

  it("a stdout line that is not JSON is skipped", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, child } = await connected();
    const events = received(adapter);

    child.emitLine("INFO  ReceiveHelper - Starting receiving messages");
    child.receive({
      sourceUuid: "uuid-ana",
      timestamp: 9,
      dataMessage: { timestamp: 9, message: "y" },
    });
    await until(() => events.length === 1, "the message after the log line");

    expect(stderr.mock.calls.some(([line]) => String(line).includes("[gateway-signal]"))).toBe(
      true,
    );
  });

  it("contains a throwing handler and keeps delivering", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, child } = await connected();
    const seen: string[] = [];
    adapter.onInbound(async (event) => {
      seen.push(event.text);
      if (event.text === "boom") throw new Error("user bug");
    });

    child.receive({
      sourceUuid: "u",
      timestamp: 1,
      dataMessage: { timestamp: 1, message: "boom" },
    });
    child.receive({
      sourceUuid: "u",
      timestamp: 2,
      dataMessage: { timestamp: 2, message: "next" },
    });
    await until(() => seen.length === 2, "both messages");

    expect(
      stderr.mock.calls.some(([line]) => String(line).includes("handler threw: user bug")),
    ).toBe(true);
  });

  it("delivers an out-of-band event through deliver()", async () => {
    const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fakeSpawn().spawn });
    const event = {
      id: "u:1",
      platform: "signal",
      sender: { id: "u" },
      channel: { id: "+1", type: "dm" },
      text: "t",
      receivedAt: 0,
      signal: { timestamp: 1, raw: {} },
    } as const;

    await expect(adapter.deliver(event)).resolves.toBe("no_handler");
    const events = received(adapter);
    await expect(adapter.deliver(event)).resolves.toBe("ok");
    expect(events).toHaveLength(1);
  });
});

describe("outbound", () => {
  it("returns empty_text before checking the connection", async () => {
    const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fakeSpawn().spawn });

    const result = await adapter.sendMessage({ channel: { id: "+1", type: "dm" }, text: "" });

    expect(result.error?.code).toBe("empty_text");
  });

  it("returns not_connected with no child", async () => {
    const adapter = new SignalAdapter({ account: ACCOUNT, spawn: fakeSpawn().spawn });

    const result = await adapter.sendMessage({ channel: { id: "+1", type: "dm" }, text: "hi" });

    expect(result.error?.code).toBe("not_connected");
  });

  it("sends to a direct recipient and reports the timestamp as the message id", async () => {
    const { adapter, child } = await connected();

    const sending = adapter.sendMessage({
      channel: { id: "+5511988887777", type: "dm" },
      text: "hi",
    });
    await until(() => child.last("send") !== undefined, "send");
    const request = child.last("send");
    child.answer(request?.id as number, { timestamp: 1_700_000_000_999, results: [] });

    await expect(sending).resolves.toEqual({ ok: true, messageId: "1700000000999" });
    expect(request?.params).toEqual({ recipient: ["+5511988887777"], message: "hi" });
  });

  it("sends to a group by groupId", async () => {
    const { adapter, child } = await connected();

    const sending = adapter.sendMessage({
      channel: { id: "group.Z3JvdXA=", type: "group" },
      text: "hi",
    });
    await until(() => child.last("send") !== undefined, "send");
    const request = child.last("send");
    child.answer(request?.id as number, { timestamp: 3 });

    await expect(sending).resolves.toEqual({ ok: true, messageId: "3" });
    expect(request?.params).toEqual({ groupId: "Z3JvdXA=", message: "hi" });
  });

  it("styles a markdown reply instead of sending its markers", async () => {
    const { adapter, child } = await connected();

    const sending = adapter.sendMessage({
      channel: { id: "+1", type: "dm" },
      text: "**Hi** team",
      format: "markdown",
    });
    await until(() => child.last("send") !== undefined, "send");
    child.answer(child.last("send")?.id as number, { timestamp: 4 });
    await sending;

    expect(child.last("send")?.params).toEqual({
      recipient: ["+1"],
      message: "Hi team",
      textStyle: ["0:2:BOLD"],
    });
  });

  it("sends html unchanged and warns once", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, child } = await connected();

    for (const id of [1, 2]) {
      const sending = adapter.sendMessage({
        channel: { id: "+1", type: "dm" },
        text: "<b>x</b>",
        format: "html",
      });
      await until(
        () => child.written.filter((r) => r.method === "send").length === id,
        `send ${id}`,
      );
      child.answer(child.last("send")?.id as number, { timestamp: id });
      await sending;
    }

    expect(child.last("send")?.params).toEqual({ recipient: ["+1"], message: "<b>x</b>" });
    expect(stderr.mock.calls.filter(([line]) => String(line).includes("html"))).toHaveLength(1);
  });

  it("maps a JSON-RPC error to signal_rpc_error", async () => {
    const { adapter, child } = await connected();

    const sending = adapter.sendMessage({ channel: { id: "+1", type: "dm" }, text: "hi" });
    await until(() => child.last("send") !== undefined, "send");
    child.fail(child.last("send")?.id as number, -32602, "Invalid recipient");

    await expect(sending).resolves.toEqual({
      ok: false,
      error: { code: "signal_rpc_error", message: "Invalid recipient" },
    });
  });

  it("times out a send after requestTimeoutMs", async () => {
    const { adapter, child } = await connected({ requestTimeoutMs: 30_000 });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const sending = adapter.sendMessage({ channel: { id: "+1", type: "dm" }, text: "hi" });
    await vi.advanceTimersByTimeAsync(30_001);

    expect((await sending).error?.code).toBe("timeout");
    expect(child.last("send")).toBeDefined();
  });

  it("settles a pending send as disconnected when the process exits", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, child } = await connected();

    const sending = adapter.sendMessage({ channel: { id: "+1", type: "dm" }, text: "hi" });
    await until(() => child.last("send") !== undefined, "send");
    child.exit(1);

    expect((await sending).error?.code).toBe("disconnected");
    const after = await adapter.sendMessage({ channel: { id: "+1", type: "dm" }, text: "again" });
    expect(after.error?.code).toBe("not_connected");
  });

  it("a write after the child closed stdin settles disconnected and does not throw", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, child } = await connected();
    child.stdin.destroy();

    const result = await adapter.sendMessage({ channel: { id: "+1", type: "dm" }, text: "hi" });

    expect(result.error?.code).toBe("disconnected");
  });

  it("settles every pending send on disconnect", async () => {
    const { adapter, child } = await connected();

    const sending = adapter.sendMessage({ channel: { id: "+1", type: "dm" }, text: "hi" });
    await until(() => child.last("send") !== undefined, "send");
    await adapter.disconnect();

    expect((await sending).error?.code).toBe("disconnected");
  });
});

describe("concurrency", () => {
  it("matches each answer to its own request when the child answers out of order", async () => {
    const { adapter, child } = await connected();

    const first = adapter.sendMessage({ channel: { id: "+1", type: "dm" }, text: "one" });
    const second = adapter.sendMessage({ channel: { id: "+2", type: "dm" }, text: "two" });
    await until(() => child.written.filter((r) => r.method === "send").length === 2, "two sends");
    const [one, two] = child.written.filter((r) => r.method === "send");
    child.answer(two?.id as number, { timestamp: 22 });
    child.answer(one?.id as number, { timestamp: 11 });

    const results = await Promise.all([first, second]);
    expect(results.map((r) => r.messageId)).toEqual(["11", "22"]);
  });

  it("settles all three pending sends when the child exits", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, child } = await connected();
    let settled = 0;

    const sends = [1, 2, 3].map((n) =>
      adapter.sendMessage({ channel: { id: `+${n}`, type: "dm" }, text: `m${n}` }).then((r) => {
        settled += 1;
        return r;
      }),
    );
    await until(() => child.written.filter((r) => r.method === "send").length === 3, "three sends");
    child.exit(137);
    const results = await Promise.all(sends);

    expect(settled).toBe(3);
    expect(results.every((r) => r.error?.code === "disconnected")).toBe(true);
  });
});
