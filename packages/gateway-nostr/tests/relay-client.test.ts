import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NostrRelayClient, NostrRelayError } from "../src/relay-client.js";
import { SeenIds } from "../src/seen-ids.js";
import { A, B, FakeRelays, note, signAuth, subId, wrapAt } from "./fake-relay.js";

let relays: FakeRelays;
let client: NostrRelayClient | undefined;

function makeClient(urls: readonly string[] = [A, B]): NostrRelayClient {
  client = new NostrRelayClient({ relays: urls, socketFactory: relays.factory, signAuth });
  return client;
}

/** Open the client with every relay accepting. */
async function openAll(urls: readonly string[] = [A, B]): Promise<NostrRelayClient> {
  const c = makeClient(urls);
  const opening = c.open();
  for (const url of urls) relays.latest(url).accept();
  await opening;
  return c;
}

beforeEach(() => {
  relays = new FakeRelays();
});

afterEach(() => {
  client?.close();
  client = undefined;
  vi.useRealTimers();
});

describe("NostrRelayClient construction", () => {
  it("throws NostrRelayError for an empty relay list", () => {
    expect(() => makeClient([])).toThrow(NostrRelayError);
  });

  it("throws NostrRelayError for a relay URL that is not ws: or wss:", () => {
    expect(() => makeClient(["https://relay.example"])).toThrow(NostrRelayError);
  });
});

describe("NostrRelayClient.open", () => {
  it("resolves within the timeout when a relay never answers", async () => {
    vi.useFakeTimers();
    const c = makeClient([A]);
    let opened = false;
    void c.open().then(() => {
      opened = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(opened).toBe(true);
  });

  it("resolves when close() is called while it is still opening", async () => {
    const c = makeClient([A]);
    const opening = c.open();
    c.close();

    await expect(opening).resolves.toBeUndefined();
  });

  it("opens no second socket when called again while connected", async () => {
    const c = await openAll([A]);
    await c.open();

    expect(relays.opened(A)).toHaveLength(1);
  });
});

describe("NostrRelayClient.subscribe", () => {
  it("delivers an event seen on two relays once", async () => {
    const c = await openAll();
    const seen: string[] = [];
    void c.subscribe([{ kinds: [1] }], (event) => {
      seen.push(event.id);
    });
    const event = note("hello");
    relays.latest(A).push(["EVENT", subId(relays.latest(A)), event]);
    relays.latest(B).push(["EVENT", subId(relays.latest(B)), event]);

    expect(seen).toEqual([event.id]);
  });

  it("delivers one event once when two relays push it in the same tick", async () => {
    const c = await openAll();
    const seen: string[] = [];
    void c.subscribe([{ kinds: [1] }], (event) => {
      seen.push(event.id);
    });
    const event = note("same tick");
    await Promise.all(
      [A, B].map(async (url) =>
        relays.latest(url).push(["EVENT", subId(relays.latest(url)), event]),
      ),
    );

    expect(seen).toHaveLength(1);
  });

  it("resolves true on the first EOSE", async () => {
    const c = await openAll();
    const done = c.subscribe([{ kinds: [1] }], () => undefined);
    relays.latest(B).push(["EOSE", subId(relays.latest(B))]);

    await expect(done).resolves.toBe(true);
  });

  it("resolves false when no relay answers EOSE within 10000 ms", async () => {
    vi.useFakeTimers();
    const c = await openAll();
    let answer: boolean | undefined;
    void c
      .subscribe([{ kinds: [1] }], () => undefined)
      .then((ok) => {
        answer = ok;
      });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(answer).toBe(false);
  });

  it("asks kind 1059 again with since at most lastSeen minus 172800 after a reconnect", async () => {
    vi.useFakeTimers();
    const c = await openAll([A]);
    void c.subscribe([{ kinds: [1059], since: 1_700_000_000 }], () => undefined);
    const first = relays.latest(A);
    const lastSeen = 1_700_100_000;
    first.push(["EVENT", subId(first), wrapAt(lastSeen)]);
    first.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = relays.latest(A);
    second.accept();

    const req = second.frames("REQ").at(-1) as [string, string, { since: number }];
    expect(req[2].since).toBeLessThanOrEqual(lastSeen - 172_800);
    expect(second).not.toBe(first);
  });
});

describe("NostrRelayClient.publish", () => {
  it("resolves ok on the first OK true", async () => {
    const c = await openAll();
    const event = note("out");
    const result = c.publish(event);
    relays.latest(A).push(["OK", event.id, true, ""]);

    await expect(result).resolves.toEqual({ ok: true });
  });

  it("gives two concurrent publishes of one event the same answer", async () => {
    const c = await openAll();
    const event = note("twice");
    const first = c.publish(event);
    const second = c.publish(event);
    relays.latest(A).push(["OK", event.id, true, ""]);

    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(relays.latest(A).frames("EVENT")).toHaveLength(1);
  });

  it("resolves relay_rejected when every relay answers false", async () => {
    const c = await openAll();
    const event = note("out");
    const result = c.publish(event);
    relays.latest(A).push(["OK", event.id, false, "blocked: spam"]);
    relays.latest(B).push(["OK", event.id, false, "blocked: spam"]);

    await expect(result).resolves.toEqual({
      ok: false,
      code: "relay_rejected",
      message: "blocked: spam",
    });
  });

  it("returns disconnected at once when no relay is open", async () => {
    const c = makeClient([A]);
    const opening = c.open();
    relays.latest(A).refuse();
    await opening;

    await expect(c.publish(note("out"))).resolves.toMatchObject({
      ok: false,
      code: "disconnected",
    });
  });

  it("settles timeout after exactly 30000 ms and not before", async () => {
    vi.useFakeTimers();
    const c = await openAll();
    let result: unknown;
    void c.publish(note("out")).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(result).toMatchObject({ ok: false, code: "timeout" });
  });

  it("settles a pending publish as disconnected on close and leaves no timer armed", async () => {
    vi.useFakeTimers();
    const c = await openAll();
    const result = c.publish(note("out"));
    c.close();

    await expect(result).resolves.toMatchObject({ ok: false, code: "disconnected" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("NostrRelayClient reconnect", () => {
  it("reopens after 1000, 2000, 4000, 8000, 16000, 30000, 30000 ms and resets after 60000 ms up", async () => {
    vi.useFakeTimers();
    await openAll([A]);
    const delays: number[] = [];
    for (let drop = 0; drop < 7; drop += 1) {
      const count = relays.opened(A).length;
      relays.latest(A).drop();
      let waited = 0;
      while (relays.opened(A).length === count) {
        await vi.advanceTimersByTimeAsync(1_000);
        waited += 1_000;
        if (waited > 60_000) throw new Error("never reopened");
      }
      delays.push(waited);
      relays.latest(A).accept();
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);

    await vi.advanceTimersByTimeAsync(60_000);
    const count = relays.opened(A).length;
    relays.latest(A).drop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(relays.opened(A)).toHaveLength(count + 1);
  });
});

describe("SeenIds", () => {
  it("never holds more than 1000 ids and forgets the oldest first", () => {
    const seen = new SeenIds();
    for (let i = 0; i < 1_500; i += 1) seen.add(`id-${i}`);

    expect(seen.size).toBe(1_000);
    expect(seen.has("id-499")).toBe(false);
    expect(seen.has("id-500")).toBe(true);
  });

  it("answers false for an id it already holds", () => {
    const seen = new SeenIds();

    expect(seen.add("a")).toBe(true);
    expect(seen.add("a")).toBe(false);
  });
});
