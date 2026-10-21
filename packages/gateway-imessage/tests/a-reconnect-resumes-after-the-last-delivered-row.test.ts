import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IMessageAdapter } from "../src/index.js";
import { type FakeChild, fakeSpawn, until } from "./fake-child.js";

type Fake = ReturnType<typeof fakeSpawn>;

/** Connect and answer the subscription of the newest child. */
async function connectOn(adapter: IMessageAdapter, fake: Fake): Promise<FakeChild> {
  const spawnedBefore = fake.children.length;
  const connecting = adapter.connect();
  await until(
    () =>
      fake.children.length > spawnedBefore &&
      fake.children.at(-1)?.last("watch.subscribe") !== undefined,
    "watch.subscribe",
  );
  const child = fake.children.at(-1) as FakeChild;
  child.answer((child.last("watch.subscribe") as { id: number }).id, { subscription: 1 });
  expect(await connecting).toBe(true);
  return child;
}

/** The adapter reports the child gone: a send is refused before any request is written. */
async function expectNotConnected(adapter: IMessageAdapter): Promise<void> {
  const result = await adapter.sendMessage({ channel: { id: "7", type: "dm" }, text: "probe" });
  expect(result.error?.code).toBe("not_connected");
}

function textsOf(events: readonly MessageEvent[]): string[] {
  return events.map((e) => e.text);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("IMessageAdapter reconnect", () => {
  it("a reconnect subscribes with since_rowid and delivers each missed row once", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });

    const first = await connectOn(adapter, fake);
    first.message({ id: 10, text: "ten" });
    first.message({ id: 11, text: "eleven" });
    await until(() => events.length === 2, "rows 10 and 11");
    first.exit(1);
    await expectNotConnected(adapter);

    const second = await connectOn(adapter, fake);
    expect(second.last("watch.subscribe")?.params).toEqual({ since_rowid: 11 });
    // imsg replays from the cursor; a row at or below it must not be delivered again.
    second.message({ id: 11, text: "eleven" });
    second.message({ id: 12, text: "twelve" });
    second.message({ id: 13, text: "thirteen" });
    await until(() => events.length === 4, "rows 12 and 13");
    await new Promise((resolve) => setImmediate(resolve));

    expect(textsOf(events)).toEqual(["ten", "eleven", "twelve", "thirteen"]);
    expect(fake.children).toHaveLength(2);
  });

  it("moves the cursor past a row it dropped as its own", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    const events: MessageEvent[] = [];
    adapter.onInbound(async (event) => {
      events.push(event);
    });

    const first = await connectOn(adapter, fake);
    first.message({ id: 20, text: "peer" });
    first.message({ id: 21, is_from_me: true, text: "my reply" });
    await until(() => events.length === 1, "row 20");
    await new Promise((resolve) => setImmediate(resolve));
    first.exit(1);
    await expectNotConnected(adapter);

    const second = await connectOn(adapter, fake);

    expect(second.last("watch.subscribe")?.params).toEqual({ since_rowid: 21 });
  });

  it("runs a row once when the child exits during its handler and the next child replays it", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    let release: () => void = () => undefined;
    const started: string[] = [];
    adapter.onInbound(async (event) => {
      started.push(event.text);
      if (event.text === "slow") await new Promise<void>((resolve) => (release = resolve));
    });

    const first = await connectOn(adapter, fake);
    first.message({ id: 30, text: "fast" });
    first.message({ id: 31, text: "slow" });
    first.message({ id: 32, text: "queued" });
    await until(() => started.includes("slow"), "the slow handler to start");
    first.exit(1);
    await expectNotConnected(adapter);
    const second = await connectOn(adapter, fake);
    expect(second.last("watch.subscribe")?.params).toEqual({ since_rowid: 30 });
    // imsg replays everything after the cursor while row 31's handler is still running.
    second.message({ id: 31, text: "slow" });
    second.message({ id: 32, text: "queued" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(started).toEqual(["fast", "slow"]);
    release();
    await until(() => started.length === 3, "the queued row from the second child");
    await new Promise((resolve) => setImmediate(resolve));

    expect(started).toEqual(["fast", "slow", "queued"]);
  });

  it("does not move the cursor past a row that arrived before any handler", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });

    const first = await connectOn(adapter, fake);
    first.message({ id: 50, text: "too early" });
    await new Promise((resolve) => setImmediate(resolve));
    adapter.onInbound(async () => undefined);
    first.exit(1);
    await expectNotConnected(adapter);
    const second = await connectOn(adapter, fake);

    expect(second.last("watch.subscribe")?.params).toEqual({});
  });

  it("a send written while the child is ending settles transport_closed", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    const child = await connectOn(adapter, fake);

    const sending = adapter.sendMessage({ channel: { id: "7", type: "dm" }, text: "hi" });
    await until(() => child.last("send") !== undefined, "send");
    // The child closed its end of the pipe: the next write fails with EPIPE on stdin.
    child.stdin.destroy(new Error("write EPIPE"));

    await expect(sending).resolves.toMatchObject({
      ok: false,
      error: { code: "transport_closed" },
    });
    await expectNotConnected(adapter);
  });

  it("settles a pending send as transport_closed when the child exits", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    const child = await connectOn(adapter, fake);

    const sending = adapter.sendMessage({ channel: { id: "7", type: "dm" }, text: "hi" });
    await until(() => child.last("send") !== undefined, "send");
    child.exit(1);

    await expect(sending).resolves.toMatchObject({
      ok: false,
      error: { code: "transport_closed" },
    });
    await connectOn(adapter, fake);
    expect(fake.calls).toHaveLength(2);
  });

  it("names imessage and the exit code on stderr when the child exits", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    const child = await connectOn(adapter, fake);

    child.exit(3);
    await expectNotConnected(adapter);

    const lines = write.mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line.includes("imessage") && line.includes("3"))).toHaveLength(1);
  });

  it("disconnect closes stdin and sends SIGTERM only after 2000 ms", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    const child = await connectOn(adapter, fake);
    vi.useFakeTimers();

    const disconnecting = adapter.disconnect();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(child.stdinEnded).toBe(true);
    expect(child.signals).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await disconnecting;

    expect(child.signals).toEqual(["SIGTERM"]);
    vi.useRealTimers();
    await expectNotConnected(adapter);
  });

  it("disconnect sends no signal when the child ends on its own", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fake = fakeSpawn();
    const adapter = new IMessageAdapter({ spawn: fake.spawn });
    const child = await connectOn(adapter, fake);
    child.stdin.on("finish", () => child.exit(0));

    await adapter.disconnect();

    expect(child.signals).toEqual([]);
  });
});
