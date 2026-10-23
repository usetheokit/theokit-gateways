import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TlonUrbitAdapter } from "../src/adapter.js";
import { essayFact, FakeShip } from "./fake-ship.js";

const open: TlonUrbitAdapter[] = [];

function makeAdapter(ship: FakeShip, botShip = "~bot"): TlonUrbitAdapter {
  const adapter = new TlonUrbitAdapter({
    shipUrl: ship.url,
    ship: botShip,
    code: "lidlut-tabwed-pillex-ridrup",
    fetch: ship.fetch,
  });
  open.push(adapter);
  return adapter;
}

async function connected(
  ship = new FakeShip(),
  botShip = "~bot",
): Promise<{ adapter: TlonUrbitAdapter; ship: FakeShip; seen: MessageEvent[] }> {
  const adapter = makeAdapter(ship, botShip);
  const seen: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    seen.push(event);
  });
  expect(await adapter.connect()).toBe(true);
  return { adapter, ship, seen };
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

afterEach(async () => {
  for (const adapter of open.splice(0)) await adapter.disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TlonUrbitAdapter inbound", () => {
  it("turns a /v3 essay from ~zod into one TlonUrbitMessageEvent whose channel is ~zod", async () => {
    const { ship, seen } = await connected();
    ship.fact(essayFact({ from: "~zod", id: "~zod/170.141.184", text: "hello" }));
    await until(() => seen.length === 1, "one event");

    const event = seen[0];
    if (event?.platform !== "tlon_urbit") throw new Error("unreachable");
    expect(event.channel).toEqual({ id: "~zod", type: "dm" });
    expect(event.text).toBe("hello");
    expect(event.tlon_urbit).toMatchObject({ ship: "~zod", messageId: "~zod/170.141.184" });
  });

  it("produces no event for an essay the bot's own ship wrote", async () => {
    const { ship, seen } = await connected();
    ship.fact(essayFact({ from: "~zod", id: "~bot/1", text: "my reply", author: "~bot" }));
    await drain();

    expect(seen).toEqual([]);
  });

  it("drops its own essays when the bot ship is given as zod, without the sig (EC-14)", async () => {
    const { ship, seen } = await connected(new FakeShip(), "zod");
    ship.fact(essayFact({ from: "~nec", id: "~zod/1", text: "mine", author: "~zod" }));
    await drain();

    expect(seen).toEqual([]);
    expect(ship.subscriptions()[0]?.action.ship).toBe("~zod");
  });

  it("produces no event for a group DM (club), whose author the sender declares", async () => {
    const { ship, seen } = await connected();
    ship.fact(essayFact({ from: "0v4.club", id: "~zod/2", text: "club", author: "~zod" }));
    await drain();

    expect(seen).toEqual([]);
  });

  it("produces no event for an essay with no text", async () => {
    const { ship, seen } = await connected();
    ship.fact(essayFact({ from: "~zod", id: "~zod/3", text: "" }));
    await drain();

    expect(seen).toEqual([]);
  });

  it("accepts an invite again when its first rsvp poke failed", async () => {
    const ship = new FakeShip();
    await connected(ship);
    ship.pokeAnswer = "err";
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    ship.fact([{ ship: "~nec" }]);
    await until(() => ship.pokes().length === 1, "the first rsvp");
    await drain();
    ship.pokeAnswer = "ok";
    ship.fact([{ ship: "~nec" }]);
    await until(() => ship.pokes().length === 2, "the second rsvp");

    expect(ship.pokes()[1]).toMatchObject({ mark: "chat-dm-rsvp" });
  });

  it("answers a DM invite with a chat-dm-rsvp poke", async () => {
    const { ship } = await connected();
    ship.fact([{ ship: "~nec" }]);
    await until(() => ship.pokes().length === 1, "the rsvp poke");

    expect(ship.pokes()[0]).toMatchObject({
      app: "chat",
      mark: "chat-dm-rsvp",
      json: { ship: "~nec", ok: true },
    });
  });

  it("delivers an essay replayed after the stream reconnects once, and answers it once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const ship = new FakeShip();
    const adapter = makeAdapter(ship);
    const handler = vi.fn(async () => undefined);
    adapter.onInbound(handler);
    const send = vi.spyOn(adapter, "sendMessage");
    await adapter.connect();
    const fact = essayFact({ from: "~zod", id: "~zod/9", text: "once" });
    ship.fact(fact);
    await vi.advanceTimersByTimeAsync(0);
    ship.endStream();
    await vi.advanceTimersByTimeAsync(1_000);
    ship.fact(fact);
    await vi.advanceTimersByTimeAsync(10);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(0);
  });

  it("logs a throwing handler as handler threw and delivers the next essay", async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const ship = new FakeShip();
    const adapter = makeAdapter(ship);
    const texts: string[] = [];
    adapter.onInbound(async (event) => {
      texts.push(event.text);
      if (texts.length === 1) throw new Error("user code failed");
    });
    await adapter.connect();
    ship.fact(essayFact({ from: "~zod", id: "~zod/a", text: "a" }));
    ship.fact(essayFact({ from: "~zod", id: "~zod/b", text: "b" }));
    await until(() => texts.length === 2, "both essays");

    expect(written.join("")).toContain("handler threw");
  });
});

describe("TlonUrbitAdapter.sendMessage", () => {
  it("returns empty_text before checking the connection", async () => {
    const result = await makeAdapter(new FakeShip()).sendMessage({
      channel: { id: "~zod", type: "dm" },
      text: "",
    });

    expect(result.error?.code).toBe("empty_text");
  });

  it("pokes chat with mark chat-dm-action and the memo shape, markers dropped", async () => {
    const { adapter, ship } = await connected();
    const result = await adapter.sendMessage({
      channel: { id: "~zod", type: "dm" },
      text: "**hi**",
      format: "markdown",
    });

    const poke = ship.pokes()[0];
    expect(poke).toMatchObject({
      action: "poke",
      ship: "~bot",
      app: "chat",
      mark: "chat-dm-action",
    });
    expect(poke?.json).toMatchObject({
      ship: "~zod",
      diff: {
        delta: {
          add: { memo: { content: [{ inline: ["hi"] }], author: "~bot" }, kind: null, time: null },
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.messageId).toMatch(/^~bot\//);
  });

  it("refuses a channel id that is not a ship before poking", async () => {
    const { adapter, ship } = await connected();
    const result = await adapter.sendMessage({ channel: { id: "zod zod", type: "dm" }, text: "x" });

    expect(result.error?.code).toBe("invalid_channel");
    expect(ship.pokes()).toEqual([]);
  });

  it("turns an err ack into tlon_poke_failed", async () => {
    const ship = new FakeShip();
    const { adapter } = await connected(ship);
    ship.pokeAnswer = "err";

    const result = await adapter.sendMessage({ channel: { id: "~zod", type: "dm" }, text: "x" });
    expect(result.error?.code).toBe("tlon_poke_failed");
  });
});

describe("TlonUrbitAdapter.connect", () => {
  it("answers false within 10000 ms when the login never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ship = new FakeShip();
    ship.login = () => new Promise(() => undefined);
    let answer: boolean | undefined;
    void makeAdapter(ship)
      .connect()
      .then((ok) => {
        answer = ok;
      });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(answer).toBe(false);
  });
});
