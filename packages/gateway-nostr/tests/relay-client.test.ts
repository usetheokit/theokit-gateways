import { finalizeEvent, generateSecretKey, type NostrEvent } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NostrRelayClient, NostrRelayError } from "../src/relay-client.js";
import { SeenIds } from "../src/seen-ids.js";
import { FakeRelays, type FakeSocket } from "./fake-relay.js";

const A = "wss://a.example";
const B = "wss://b.example";
const KEY = generateSecretKey();

function note(content: string, createdAt = 1_700_000_000): NostrEvent {
  return finalizeEvent({ kind: 1, content, tags: [], created_at: createdAt }, KEY);
}

function wrapAt(createdAt: number): NostrEvent {
  return finalizeEvent({ kind: 1059, content: "x", tags: [], created_at: createdAt }, KEY);
}

const signAuth = async (challenge: string, relay: string): Promise<NostrEvent> =>
  finalizeEvent(
    {
      kind: 22242,
      content: "",
      tags: [
        ["relay", relay],
        ["challenge", challenge],
      ],
      created_at: 1_700_000_000,
    },
    KEY,
  );

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

function subId(socket: FakeSocket): string {
  const req = socket.frames("REQ").at(-1);
  if (req === undefined) throw new Error(`no REQ on ${socket.url}`);
  return req[1] as string;
}

/** Let pending promise callbacks run, under fake or real timers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
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

describe("NostrRelayClient NIP-42 AUTH", () => {
  it("answers a challenge with a signed kind 22242 event and re-sends the REQ after OK true", async () => {
    const c = await openAll([A]);
    void c.subscribe([{ kinds: [1] }], () => undefined);
    const socket = relays.latest(A);
    socket.push(["AUTH", "challenge-1"]);
    await settle();

    const auth = socket.frames("AUTH").at(-1)?.[1] as NostrEvent;
    expect(auth.kind).toBe(22242);
    expect(auth.tags).toContainEqual(["challenge", "challenge-1"]);
    expect(auth.tags).toContainEqual(["relay", A]);
    const reqsBefore = socket.frames("REQ").length;
    socket.push(["OK", auth.id, true, ""]);

    expect(socket.frames("REQ")).toHaveLength(reqsBefore + 1);
  });

  it("re-sends nothing until the relay answers OK true for the AUTH event", async () => {
    const c = await openAll([A]);
    void c.subscribe([{ kinds: [1] }], () => undefined);
    const socket = relays.latest(A);
    const event = note("out");
    void c.publish(event);
    socket.push(["OK", event.id, false, "auth-required: sign in"]);
    socket.push(["AUTH", "challenge-2"]);
    await settle();
    const before = socket.sent.length;
    await settle();
    expect(socket.sent).toHaveLength(before);

    const auth = socket.frames("AUTH").at(-1)?.[1] as NostrEvent;
    socket.push(["OK", auth.id, true, ""]);

    const after = socket.sent.slice(before).map((frame) => frame[0]);
    expect(after).toContain("REQ");
    expect(after).toContain("EVENT");
  });

  it("re-sends the pending EVENT as well as the REQs after OK false auth-required (EC-7)", async () => {
    const c = await openAll([A]);
    void c.subscribe([{ kinds: [1] }], () => undefined);
    const socket = relays.latest(A);
    const event = note("out");
    const result = c.publish(event);
    socket.push(["AUTH", "challenge-3"]);
    socket.push(["OK", event.id, false, "auth-required: sign in"]);
    await settle();
    const auth = socket.frames("AUTH").at(-1)?.[1] as NostrEvent;
    socket.push(["OK", auth.id, true, ""]);

    const events = socket.frames("EVENT").map((frame) => (frame[1] as NostrEvent).id);
    expect(events.filter((id) => id === event.id)).toHaveLength(2);
    socket.push(["OK", event.id, true, ""]);
    await expect(result).resolves.toEqual({ ok: true });
  });

  it("settles a publish pending only on a relay that refused the AUTH as relay_rejected", async () => {
    const c = await openAll([A]);
    const socket = relays.latest(A);
    const event = note("out");
    const result = c.publish(event);
    socket.push(["OK", event.id, false, "auth-required: sign in"]);
    socket.push(["AUTH", "challenge-4"]);
    await settle();
    const auth = socket.frames("AUTH").at(-1)?.[1] as NostrEvent;
    const before = socket.sent.length;
    socket.push(["OK", auth.id, false, "restricted"]);

    await expect(result).resolves.toMatchObject({ ok: false, code: "relay_rejected" });
    expect(socket.sent).toHaveLength(before);
  });

  it("re-sends nothing when the AUTH event gets no OK within 10000 ms", async () => {
    vi.useFakeTimers();
    const c = await openAll([A]);
    void c.subscribe([{ kinds: [1] }], () => undefined);
    const socket = relays.latest(A);
    socket.push(["AUTH", "challenge-5"]);
    await vi.advanceTimersByTimeAsync(0);
    const before = socket.sent.length;
    await vi.advanceTimersByTimeAsync(10_000);
    const auth = socket.frames("AUTH").at(-1)?.[1] as NostrEvent;
    socket.push(["OK", auth.id, true, ""]);

    expect(socket.sent).toHaveLength(before);
  });
});

describe("NostrRelayClient AUTH refusals", () => {
  it("counts a refused AUTH as a refusal of every publish pending on that relay", async () => {
    const c = await openAll([A]);
    const socket = relays.latest(A);
    const event = note("out");
    const result = c.publish(event);
    socket.push(["AUTH", "challenge-6"]);
    await settle();
    const auth = socket.frames("AUTH").at(-1)?.[1] as NostrEvent;
    socket.push(["OK", auth.id, false, "restricted"]);

    await expect(result).resolves.toMatchObject({ ok: false, code: "relay_rejected" });
  });

  it("counts auth-required from a relay already authenticated as a refusal", async () => {
    const c = await openAll([A]);
    const socket = relays.latest(A);
    socket.push(["AUTH", "challenge-7"]);
    await settle();
    const auth = socket.frames("AUTH").at(-1)?.[1] as NostrEvent;
    socket.push(["OK", auth.id, true, ""]);
    const event = note("out");
    const result = c.publish(event);
    socket.push(["OK", event.id, false, "auth-required: again"]);

    await expect(result).resolves.toMatchObject({ ok: false, code: "relay_rejected" });
  });

  it("gives up on an AUTH whose signing never finishes after the timeout", async () => {
    vi.useFakeTimers();
    client = new NostrRelayClient({
      relays: [A],
      socketFactory: relays.factory,
      signAuth: () => new Promise<NostrEvent>(() => undefined),
    });
    const opening = client.open();
    relays.latest(A).accept();
    await opening;
    const socket = relays.latest(A);
    const event = note("out");
    let result: unknown;
    void client.publish(event).then((r) => {
      result = r;
    });
    socket.push(["OK", event.id, false, "auth-required: sign in"]);
    socket.push(["AUTH", "challenge-8"]);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(result).toMatchObject({ ok: false, code: "relay_rejected" });
  });
});

describe("NostrRelayClient stale answers", () => {
  it("logs a CLOSED whose reason is not auth-required", async () => {
    const c = await openAll([A]);
    void c.subscribe([{ kinds: [1] }], () => undefined);
    const socket = relays.latest(A);
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    socket.push(["CLOSED", subId(socket), "error: too many subscriptions"]);
    socket.push(["CLOSED", subId(socket), "auth-required: sign in"]);
    spy.mockRestore();

    expect(written).toHaveLength(1);
    expect(written[0]).toContain("too many subscriptions");
  });

  it("keeps a new connection's AUTH when an old connection's signer rejects late", async () => {
    let rejectOld: (err: Error) => void = () => undefined;
    let calls = 0;
    client = new NostrRelayClient({
      relays: [A],
      socketFactory: relays.factory,
      signAuth: (challenge, relay) => {
        calls += 1;
        if (calls === 1) {
          return new Promise<NostrEvent>((_resolve, reject) => {
            rejectOld = reject;
          });
        }
        return signAuth(challenge, relay);
      },
    });
    const opening = client.open();
    relays.latest(A).accept();
    await opening;
    relays.latest(A).push(["AUTH", "old"]);
    vi.useFakeTimers();
    relays.latest(A).drop();
    await vi.advanceTimersByTimeAsync(1_000);
    vi.useRealTimers();
    const fresh = relays.latest(A);
    fresh.accept();
    const event = note("out");
    const result = client.publish(event);
    fresh.push(["OK", event.id, false, "auth-required: sign in"]);
    fresh.push(["AUTH", "new"]);
    await settle();
    rejectOld(new Error("old signer gave up"));
    await settle();
    const auth = fresh.frames("AUTH").at(-1)?.[1] as NostrEvent;
    fresh.push(["OK", auth.id, true, ""]);
    fresh.push(["OK", event.id, true, ""]);

    await expect(result).resolves.toEqual({ ok: true });
  });

  it("keeps a second AUTH on one connection when the first signer rejects after it timed out", async () => {
    vi.useFakeTimers();
    let rejectFirst: (err: Error) => void = () => undefined;
    let calls = 0;
    client = new NostrRelayClient({
      relays: [A],
      socketFactory: relays.factory,
      signAuth: (challenge, relay) => {
        calls += 1;
        if (calls === 1) {
          return new Promise<NostrEvent>((_resolve, reject) => {
            rejectFirst = reject;
          });
        }
        return signAuth(challenge, relay);
      },
    });
    const opening = client.open();
    relays.latest(A).accept();
    await opening;
    const socket = relays.latest(A);
    socket.push(["AUTH", "first"]);
    await vi.advanceTimersByTimeAsync(10_000);
    const event = note("out");
    let result: unknown;
    void client.publish(event).then((r) => {
      result = r;
    });
    socket.push(["OK", event.id, false, "auth-required: sign in"]);
    socket.push(["AUTH", "second"]);
    await vi.advanceTimersByTimeAsync(0);
    rejectFirst(new Error("first signer gave up"));
    await vi.advanceTimersByTimeAsync(0);
    const auth = socket.frames("AUTH").at(-1)?.[1] as NostrEvent;
    socket.push(["OK", auth.id, true, ""]);
    socket.push(["OK", event.id, true, ""]);
    await vi.advanceTimersByTimeAsync(0);

    expect(result).toEqual({ ok: true });
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
