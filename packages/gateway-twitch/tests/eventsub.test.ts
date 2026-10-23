import { afterEach, describe, expect, it, vi } from "vitest";

import { EventSubSession } from "../src/eventsub.js";
import { FakeSockets } from "./fakes.js";

const URL = "wss://eventsub.example/ws";

let session: EventSubSession | undefined;

function open(sockets: FakeSockets): { welcomes: Array<[string, string]>; notes: unknown[] } {
  const welcomes: Array<[string, string]> = [];
  const notes: unknown[] = [];
  session = new EventSubSession({
    url: URL,
    socketFactory: sockets.factory,
    onWelcome: (id, kind) => welcomes.push([id, kind]),
    onNotification: (metadata) => notes.push(metadata),
    onRevocation: () => undefined,
  });
  session.open();
  return { welcomes, notes };
}

afterEach(() => {
  session?.close();
  session = undefined;
  vi.useRealTimers();
});

describe("EventSubSession", () => {
  it("reports the welcome's session id as a new session", () => {
    const sockets = new FakeSockets();
    const { welcomes } = open(sockets);
    sockets.latest().welcome("s1");

    expect(welcomes).toEqual([["s1", "new"]]);
  });

  it("opens reconnect_url before closing the old socket, and closes it on the new welcome", () => {
    const sockets = new FakeSockets();
    const { welcomes } = open(sockets);
    const old = sockets.latest();
    old.welcome("s1");
    old.reconnectTo("wss://eventsub.example/ws?reconnect=1");

    const fresh = sockets.latest();
    expect(fresh).not.toBe(old);
    expect(fresh.url).toBe("wss://eventsub.example/ws?reconnect=1");
    expect(old.closed).toBe(false);
    fresh.welcome("s1");
    expect(old.closed).toBe(true);
    expect(welcomes).toEqual([
      ["s1", "new"],
      ["s1", "handover"],
    ]);
  });

  it("forwards a notification from both sockets during a handover, for the adapter to dedupe", () => {
    const sockets = new FakeSockets();
    const { notes } = open(sockets);
    const old = sockets.latest();
    old.welcome("s1");
    old.reconnectTo("wss://eventsub.example/ws?reconnect=1");
    const fresh = sockets.latest();
    old.chat({ messageId: "same" });
    fresh.chat({ messageId: "same" });

    expect(notes).toHaveLength(2);
  });

  it("reconnects and resubscribes when no frame arrives for keepalive_timeout_seconds + 5 s", async () => {
    vi.useFakeTimers();
    const sockets = new FakeSockets();
    const { welcomes } = open(sockets);
    sockets.latest().welcome("s1", 10);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(sockets.opened).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sockets.opened).toHaveLength(2);
    sockets.latest().welcome("s2");
    expect(welcomes.at(-1)).toEqual(["s2", "new"]);
  });

  it("keeps the session while frames arrive inside the keepalive window", async () => {
    vi.useFakeTimers();
    const sockets = new FakeSockets();
    open(sockets);
    sockets.latest().welcome("s1", 10);
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(9_000);
      sockets.latest().keepalive();
    }

    expect(sockets.opened).toHaveLength(1);
  });

  it("reopens after 1000, 2000, 4000, 8000, 16000, 30000, 30000 ms, and resets after 60000 ms up", async () => {
    vi.useFakeTimers();
    const sockets = new FakeSockets();
    open(sockets);
    sockets.latest().welcome("s0");
    const delays: number[] = [];
    for (let drop = 0; drop < 7; drop += 1) {
      const count = sockets.opened.length;
      sockets.latest().drop();
      let waited = 0;
      while (sockets.opened.length === count) {
        await vi.advanceTimersByTimeAsync(1_000);
        waited += 1_000;
        if (waited > 60_000) throw new Error("never reopened");
      }
      delays.push(waited);
      sockets.latest().welcome(`s${drop + 1}`, 600);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);

    await vi.advanceTimersByTimeAsync(60_000);
    const count = sockets.opened.length;
    sockets.latest().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets.opened).toHaveLength(count + 1);
  });

  it("redials a socket that never sends its welcome within 10000 ms", async () => {
    vi.useFakeTimers();
    const sockets = new FakeSockets();
    open(sockets);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sockets.opened).toHaveLength(2);
  });

  it("drops a handover socket that is never welcomed and keeps serving on the old one", async () => {
    vi.useFakeTimers();
    const sockets = new FakeSockets();
    const { notes } = open(sockets);
    const old = sockets.latest();
    old.welcome("s1", 600);
    old.reconnectTo("wss://eventsub.example/ws?reconnect=1");
    const stuck = sockets.latest();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(stuck.closed).toBe(true);
    expect(old.closed).toBe(false);
    old.chat({ messageId: "still" });
    expect(notes).toHaveLength(1);
  });

  it("retires the current socket when open() is called again", () => {
    const sockets = new FakeSockets();
    open(sockets);
    const first = sockets.latest();
    session?.open();

    expect(first.closed).toBe(true);
    expect(sockets.opened).toHaveLength(2);
  });

  it("closes both sockets during a handover and leaves no timer armed on close()", () => {
    vi.useFakeTimers();
    const sockets = new FakeSockets();
    open(sockets);
    const old = sockets.latest();
    old.welcome("s1");
    old.reconnectTo("wss://eventsub.example/ws?reconnect=1");
    const fresh = sockets.latest();
    session?.close();

    expect([old.closed, fresh.closed]).toEqual([true, true]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
