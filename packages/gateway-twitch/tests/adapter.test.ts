import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TwitchAdapter } from "../src/adapter.js";
import { splitForTwitch } from "../src/split.js";
import { BOT, BROADCASTER, FakeHelix, FakeSockets, TOKEN } from "./fakes.js";

const adapters: TwitchAdapter[] = [];

function makeAdapter(
  helix: FakeHelix,
  sockets: FakeSockets,
  broadcasters = [BROADCASTER],
): TwitchAdapter {
  const adapter = new TwitchAdapter({
    accessToken: TOKEN,
    botUserId: BOT,
    broadcasterUserIds: broadcasters,
    fetch: helix.fetch,
    socketFactory: sockets.factory,
  });
  adapters.push(adapter);
  return adapter;
}

/** Connect with Twitch answering the welcome. */
async function connected(
  helix = new FakeHelix(),
  sockets = new FakeSockets(),
): Promise<{
  adapter: TwitchAdapter;
  helix: FakeHelix;
  sockets: FakeSockets;
  seen: MessageEvent[];
}> {
  const adapter = makeAdapter(helix, sockets);
  const seen: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    seen.push(event);
  });
  const connecting = adapter.connect();
  await until(() => sockets.opened.length === 1, "the EventSub socket");
  sockets.latest().welcome("s1");
  expect(await connecting).toBe(true);
  return { adapter, helix, sockets, seen };
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function quiet(): string[] {
  const written: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  return written;
}

afterEach(async () => {
  for (const adapter of adapters.splice(0)) await adapter.disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TwitchAdapter.connect", () => {
  it("returns false when the token lacks user:write:chat", async () => {
    quiet();
    const helix = new FakeHelix();
    helix.scopes = ["user:read:chat"];

    await expect(makeAdapter(helix, new FakeSockets()).connect()).resolves.toBe(false);
  });

  it("returns false when the token belongs to another user", async () => {
    quiet();
    const helix = new FakeHelix();
    helix.userId = "9999";

    await expect(makeAdapter(helix, new FakeSockets()).connect()).resolves.toBe(false);
  });

  it("subscribes to channel.chat.message once per broadcaster on the welcome", async () => {
    const helix = new FakeHelix();
    const sockets = new FakeSockets();
    const adapter = makeAdapter(helix, sockets, ["2002", "2003"]);
    const connecting = adapter.connect();
    await until(() => sockets.opened.length === 1, "the socket");
    sockets.latest().welcome("s1");
    await connecting;

    expect(helix.subscriptions).toEqual(
      ["2002", "2003"].map((broadcaster) => ({
        type: "channel.chat.message",
        version: "1",
        condition: { broadcaster_user_id: broadcaster, user_id: BOT },
        transport: { method: "websocket", session_id: "s1" },
      })),
    );
  });

  it("returns false and closes the socket when one subscription is answered 403 (EC-17)", async () => {
    quiet();
    const helix = new FakeHelix();
    helix.subscribeStatus = (broadcaster) => (broadcaster === "2003" ? 403 : 202);
    const sockets = new FakeSockets();
    const adapter = makeAdapter(helix, sockets, ["2002", "2003"]);
    const connecting = adapter.connect();
    await until(() => sockets.opened.length === 1, "the socket");
    sockets.latest().welcome("s1");

    expect(await connecting).toBe(false);
    expect(sockets.latest().closed).toBe(true);
  });

  it("opens no socket when disconnect() lands while the token is being validated", async () => {
    const helix = new FakeHelix();
    const sockets = new FakeSockets();
    let answerValidate: () => void = () => undefined;
    const validated = new Promise<void>((resolve) => {
      answerValidate = resolve;
    });
    const fetchFn = helix.fetch;
    const adapter = new TwitchAdapter({
      accessToken: TOKEN,
      botUserId: BOT,
      broadcasterUserIds: [BROADCASTER],
      fetch: async (input, init) => {
        if (String(input).includes("validate")) await validated;
        return fetchFn(input, init);
      },
      socketFactory: sockets.factory,
    });
    adapters.push(adapter);
    const connecting = adapter.connect();
    await adapter.disconnect();
    answerValidate();

    expect(await connecting).toBe(false);
    expect(sockets.opened).toEqual([]);
  });

  it("starts a new session when a resubscription after a drop is refused", async () => {
    quiet();
    const { helix, sockets } = await connected();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    helix.subscribeStatus = () => 403;
    sockets.latest().drop();
    await vi.advanceTimersByTimeAsync(1_000);
    sockets.latest().welcome("s2", 600);
    await vi.advanceTimersByTimeAsync(0);
    const refusedSocket = sockets.latest();
    helix.subscribeStatus = () => 202;
    await vi.advanceTimersByTimeAsync(2_000);

    expect(refusedSocket.closed).toBe(true);
    expect(sockets.opened.length).toBeGreaterThan(2);
  });

  it("resolves false within 10000 ms when the socket never sends session_welcome", async () => {
    vi.useFakeTimers();
    quiet();
    let answer: boolean | undefined;
    void makeAdapter(new FakeHelix(), new FakeSockets())
      .connect()
      .then((ok) => {
        answer = ok;
      });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(answer).toBe(false);
  });
});

describe("TwitchAdapter inbound", () => {
  it("turns a channel.chat.message notification into one TwitchMessageEvent", async () => {
    const { sockets, seen } = await connected();
    sockets.latest().chat({ messageId: "n1", text: "hi bot" });
    await until(() => seen.length === 1, "one event");

    const event = seen[0];
    if (event?.platform !== "twitch") throw new Error("unreachable");
    expect(event.channel).toEqual({ id: BROADCASTER, type: "group" });
    expect(event.text).toBe("hi bot");
    expect(event.twitch).toMatchObject({
      broadcasterUserId: BROADCASTER,
      chatterUserId: "3003",
      chatterLogin: "viewer",
    });
  });

  it("produces no event for a message from the bot's own user id", async () => {
    const { sockets, seen } = await connected();
    sockets.latest().chat({ messageId: "own", chatter: BOT });
    await drain();

    expect(seen).toEqual([]);
  });

  it("delivers a repeated metadata message_id once, also across a handover", async () => {
    const { sockets, seen } = await connected();
    const old = sockets.latest();
    old.chat({ messageId: "dup" });
    old.reconnectTo("wss://eventsub.example/ws?reconnect=1");
    sockets.latest().chat({ messageId: "dup" });
    await drain();

    expect(seen).toHaveLength(1);
  });

  it("logs a revocation once with its type, broadcaster and status (EC-18)", async () => {
    const written = quiet();
    const { sockets } = await connected();
    sockets.latest().revoke("authorization_revoked");

    const lines = written.filter((line) => line.includes("revoked"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("channel.chat.message");
    expect(lines[0]).toContain(BROADCASTER);
    expect(lines[0]).toContain("authorization_revoked");
  });

  it("logs a throwing handler as handler threw and delivers the next message", async () => {
    const written = quiet();
    const helix = new FakeHelix();
    const sockets = new FakeSockets();
    const adapter = makeAdapter(helix, sockets);
    const texts: string[] = [];
    adapter.onInbound(async (event) => {
      texts.push(event.text);
      if (texts.length === 1) throw new Error("user code failed");
    });
    const connecting = adapter.connect();
    await until(() => sockets.opened.length === 1, "the socket");
    sockets.latest().welcome("s1");
    await connecting;
    sockets.latest().chat({ messageId: "a", text: "a" });
    sockets.latest().chat({ messageId: "b", text: "b" });
    await until(() => texts.length === 2, "both messages");

    expect(written.join("")).toContain("handler threw");
  });
});

describe("TwitchAdapter.sendMessage", () => {
  it("returns empty_text before checking the connection", async () => {
    const result = await makeAdapter(new FakeHelix(), new FakeSockets()).sendMessage({
      channel: { id: BROADCASTER, type: "group" },
      text: "",
    });

    expect(result.error?.code).toBe("empty_text");
  });

  it("sends a 1200-character reply as three messages of at most 500, in order, answering the last id (EC-1)", async () => {
    const { adapter, helix } = await connected();
    const text = `${"a".repeat(500)}${"b".repeat(500)}${"c".repeat(200)}`;
    const result = await adapter.sendMessage({ channel: { id: BROADCASTER, type: "group" }, text });

    expect(helix.sent.map((body) => String(body.message).length)).toEqual([500, 500, 200]);
    expect(helix.sent.map((body) => String(body.message)[0])).toEqual(["a", "b", "c"]);
    expect(result).toEqual({ ok: true, messageId: "sent-3" });
  });

  it("turns is_sent false into twitch_message_dropped with the drop reason", async () => {
    const helix = new FakeHelix();
    const { adapter } = await connected(helix);
    helix.send = async () =>
      Response.json({
        data: [
          {
            message_id: "",
            is_sent: false,
            drop_reason: { code: "followers_only", message: "follower-only mode" },
          },
        ],
      });
    const result = await adapter.sendMessage({
      channel: { id: BROADCASTER, type: "group" },
      text: "x",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "twitch_message_dropped", message: "follower-only mode" },
    });
  });

  it("refuses a channel id that is not a numeric user id before sending", async () => {
    const { adapter, helix } = await connected();
    const result = await adapter.sendMessage({
      channel: { id: "#streamer", type: "group" },
      text: "x",
    });

    expect(result.error?.code).toBe("invalid_channel");
    expect(helix.sent).toEqual([]);
  });

  it("settles timeout after 30000 ms when Send Chat Message never answers", async () => {
    const helix = new FakeHelix();
    const { adapter } = await connected(helix);
    vi.useFakeTimers();
    helix.send = () => new Promise(() => undefined);
    let result: unknown;
    void adapter
      .sendMessage({ channel: { id: BROADCASTER, type: "group" }, text: "x" })
      .then((r) => {
        result = r;
      });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
  });
});

describe("splitForTwitch", () => {
  it("keeps a text of 500 characters whole and never returns an empty part", () => {
    expect(splitForTwitch("x".repeat(500))).toEqual(["x".repeat(500)]);
    expect(splitForTwitch("")).toEqual([]);
  });
});
