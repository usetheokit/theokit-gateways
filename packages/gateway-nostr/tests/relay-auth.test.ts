/** NIP-42 authentication of NostrRelayClient: the order of AUTH and re-sends, refusals, stale answers. */

import type { NostrEvent } from "nostr-tools/pure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NostrRelayClient } from "../src/relay-client.js";
import { A, B, FakeRelays, note, settle, signAuth, subId } from "./fake-relay.js";

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
