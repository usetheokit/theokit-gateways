import { afterEach, describe, expect, it, vi } from "vitest";

import { TlonAuthError } from "../src/errors.js";
import { UrbitShipClient } from "../src/ship-client.js";
import { essayFact, FakeShip } from "./fake-ship.js";

let client: UrbitShipClient | undefined;

function makeClient(
  ship: FakeShip,
  onFact: (fact: unknown) => void = () => undefined,
  onStopped: (err: Error) => void = () => undefined,
): UrbitShipClient {
  client = new UrbitShipClient({
    shipUrl: ship.url,
    ship: "~bot",
    code: "lidlut-tabwed-pillex-ridrup",
    fetch: ship.fetch,
    onFact,
    onStopped,
  });
  return client;
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function quiet(): void {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

afterEach(() => {
  client?.close();
  client = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("UrbitShipClient.open", () => {
  it("logs in, subscribes to chat /v3 and answers true on the subscribe ack", async () => {
    const ship = new FakeShip();

    await expect(makeClient(ship).open()).resolves.toBe(true);
    expect(ship.logins).toEqual(["password=lidlut-tabwed-pillex-ridrup"]);
    expect(ship.subscriptions()[0]?.action).toMatchObject({
      action: "subscribe",
      ship: "~bot",
      app: "chat",
      path: "/v3",
    });
  });

  it("answers false within 10000 ms when the login never answers", async () => {
    vi.useFakeTimers();
    quiet();
    const ship = new FakeShip();
    ship.login = () => new Promise(() => undefined);
    let answer: boolean | undefined;
    void makeClient(ship)
      .open()
      .then((ok) => {
        answer = ok;
      });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(answer).toBe(false);
  });

  it("answers false when the login is refused", async () => {
    quiet();
    const ship = new FakeShip();
    ship.login = async () => new Response(null, { status: 403 });

    await expect(makeClient(ship).open()).resolves.toBe(false);
  });
});

describe("UrbitShipClient stream", () => {
  it("acknowledges every frame it reads with its event id", async () => {
    const ship = new FakeShip();
    const facts: unknown[] = [];
    await makeClient(ship, (fact) => facts.push(fact)).open();
    ship.fact(essayFact({ from: "~zod", id: "~zod/1", text: "a" }));
    ship.fact(essayFact({ from: "~zod", id: "~zod/2", text: "b" }));
    await until(() => ship.acks().length === 3, "three acks");

    expect(ship.acks()).toEqual([1, 2, 3]);
    expect(facts).toHaveLength(2);
  });

  it("opens a new channel and subscribes again when the re-GET answers 404 (EC-16)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    quiet();
    const ship = new FakeShip();
    await makeClient(ship).open();
    const first = ship.subscriptions()[0]?.channel;
    ship.getStatus = (channel) => (channel === first ? 404 : 200);
    ship.endStream();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);

    const channels = ship.subscriptions().map((s) => s.channel);
    expect(channels).toHaveLength(2);
    expect(channels[1]).not.toBe(first);
  });

  it("reports TlonAuthError and stops retrying when a re-login is refused with 403", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    quiet();
    const ship = new FakeShip();
    const stopped: Error[] = [];
    await makeClient(
      ship,
      () => undefined,
      (err) => stopped.push(err),
    ).open();
    ship.getStatus = () => 401;
    ship.login = async () => new Response(null, { status: 403 });
    ship.endStream();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);
    const getsAfterStop = ship.gets.length;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toBeInstanceOf(TlonAuthError);
    expect(ship.gets.length).toBe(getsAfterStop);
  });

  it("re-GETs after 1000, 2000, 4000, 8000, 16000, 30000, 30000 ms, and resets after 60000 ms up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const ship = new FakeShip();
    await makeClient(ship).open();
    const delays: number[] = [];
    for (let end = 0; end < 7; end += 1) {
      const count = ship.gets.length;
      ship.endStream();
      let waited = 0;
      while (ship.gets.length === count) {
        await vi.advanceTimersByTimeAsync(1_000);
        waited += 1_000;
        if (waited > 60_000) throw new Error("never re-opened");
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);

    await vi.advanceTimersByTimeAsync(60_000);
    const count = ship.gets.length;
    ship.endStream();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ship.gets.length).toBe(count + 1);
  });
});

describe("UrbitShipClient session", () => {
  it("subscribes again when the ship ends the chat subscription with quit", async () => {
    const ship = new FakeShip();
    await makeClient(ship).open();
    ship.quit();
    await until(() => ship.subscriptions().length === 2, "a second subscription");

    expect(ship.subscriptions()[1]?.action).toMatchObject({ app: "chat", path: "/v3" });
  });

  it("tries again when a re-GET never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    quiet();
    const ship = new FakeShip();
    await makeClient(ship).open();
    ship.hangGets = true;
    ship.endStream();
    await vi.advanceTimersByTimeAsync(1_000);
    const hung = ship.gets.length;
    await vi.advanceTimersByTimeAsync(10_000 + 2_000);

    expect(ship.gets.length).toBeGreaterThan(hung);
  });

  it("opens one channel when a second open() follows a close() while the first login is pending", async () => {
    const ship = new FakeShip();
    let answerFirst: (response: Response) => void = () => undefined;
    let logins = 0;
    const cookie = { status: 204, headers: { "set-cookie": "urbauth-~bot=0v1; Path=/" } };
    ship.login = () => {
      logins += 1;
      if (logins === 1) {
        return new Promise((resolve) => {
          answerFirst = resolve;
        });
      }
      return Promise.resolve(new Response(null, cookie));
    };
    const c = makeClient(ship);
    const first = c.open();
    c.close();
    const second = await c.open();
    answerFirst(new Response(null, cookie));
    await first;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(second).toBe(true);
    expect(ship.subscriptions()).toHaveLength(1);
  });
});

describe("UrbitShipClient.poke", () => {
  it("settles ok from its own ack, for two pokes started together", async () => {
    const ship = new FakeShip();
    const c = makeClient(ship);
    await c.open();
    const results = await Promise.all([
      c.poke("chat", "chat-dm-action", { n: 1 }),
      c.poke("chat", "chat-dm-action", { n: 2 }),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    const ids = ship.pokes().map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("turns an err ack into tlon_poke_failed", async () => {
    const ship = new FakeShip();
    ship.pokeAnswer = "err";
    const c = makeClient(ship);
    await c.open();

    await expect(c.poke("chat", "chat-dm-action", {})).resolves.toMatchObject({
      ok: false,
      code: "tlon_poke_failed",
    });
  });

  it("settles timeout after 30000 ms when no ack arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const ship = new FakeShip();
    ship.pokeAnswer = "none";
    const c = makeClient(ship);
    await c.open();
    let result: unknown;
    void c.poke("chat", "chat-dm-action", {}).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });

  it("settles pending pokes as disconnected on close and leaves no timer armed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const ship = new FakeShip();
    ship.pokeAnswer = "none";
    const c = makeClient(ship);
    await c.open();
    const pending = c.poke("chat", "chat-dm-action", {});
    c.close();

    await expect(pending).resolves.toMatchObject({ ok: false, code: "disconnected" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
