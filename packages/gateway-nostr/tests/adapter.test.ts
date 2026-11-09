import type { MessageEvent } from "@theokit/gateway";
import type { Filter } from "nostr-tools/filter";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { createRumor, createSeal, createWrap } from "nostr-tools/nip59";
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from "nostr-tools/pure";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NostrAdapter } from "../src/adapter.js";
import { openGiftWrap, openNip04, sealDirectMessage, sealNip04 } from "../src/dm.js";
import type { NostrPublishResult } from "../src/relay-client.js";
import type { NostrRelayLike } from "../src/types.js";
import { FakeRelays } from "./fake-relay.js";

const botKey = generateSecretKey();
const botPub = getPublicKey(botKey);
const botHex = Buffer.from(botKey).toString("hex");
const peerKey = generateSecretKey();
const peerPub = getPublicKey(peerKey);

/** Unix seconds the adapters under test treat as their start. */
const START = 1_800_000_000;

/** What a relay holds, shared by every client opened over it. */
class FakeStore {
  readonly events: NostrEvent[] = [];
  readonly published: NostrEvent[] = [];
  answer: (event: NostrEvent) => NostrPublishResult = () => ({ ok: true });
}

/** A relay client over a fake store: replays the store before `EOSE`, then pushes live. */
class FakeClient implements NostrRelayLike {
  readonly filters: Filter[][] = [];
  private onEvent: ((event: NostrEvent, relay: string) => void) | undefined;
  closed = 0;

  constructor(private readonly store: FakeStore) {}

  async open(): Promise<void> {}

  async subscribe(
    filters: readonly Filter[],
    onEvent: (event: NostrEvent, relay: string) => void,
  ): Promise<boolean> {
    this.filters.push([...filters]);
    this.onEvent = onEvent;
    for (const event of this.store.events) onEvent(event, "wss://fake");
    return true;
  }

  async publish(event: NostrEvent): Promise<NostrPublishResult> {
    this.store.published.push(event);
    return this.store.answer(event);
  }

  close(): void {
    this.closed += 1;
  }

  push(event: NostrEvent): void {
    this.store.events.push(event);
    this.onEvent?.(event, "wss://fake");
  }
}

function giftFromPeer(text: string, rumorAt = START + 10, wrapAt?: number): NostrEvent {
  const rumor = createRumor(
    { kind: 14, content: text, tags: [["p", botPub]], created_at: rumorAt },
    peerKey,
  );
  const wrap = createWrap(createSeal(rumor, peerKey, botPub), botPub);
  if (wrapAt === undefined) return wrap;
  // A wrap is signed by a throwaway key; re-dating means re-wrapping the same seal.
  return rewrap(createSeal(rumor, peerKey, botPub), wrapAt);
}

function rewrap(seal: NostrEvent, createdAt: number): NostrEvent {
  const throwaway = generateSecretKey();
  const content = encrypt(JSON.stringify(seal), getConversationKey(throwaway, botPub));
  return finalizeEvent(
    { kind: 1059, content, tags: [["p", botPub]], created_at: createdAt },
    throwaway,
  );
}

/** A kind 4 message from `key` to the bot, dated `createdAt`. */
function legacy(key: Uint8Array, text: string, createdAt: number): NostrEvent {
  const sealed = sealNip04(key, botPub, text);
  return finalizeEvent(
    { kind: 4, content: sealed.content, tags: sealed.tags, created_at: createdAt },
    key,
  );
}

function makeAdapter(client: FakeClient, ignoreBefore = START): NostrAdapter {
  return new NostrAdapter({ secretKey: botHex, relays: ["wss://fake"], ignoreBefore, client });
}

/** Subscribe a handler that records events. */
function recording(adapter: NostrAdapter): MessageEvent[] {
  const seen: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    seen.push(event);
  });
  return seen;
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** Let queued deliveries run. */
async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("NostrAdapter inbound", () => {
  it("turns a NIP-17 gift wrap into one NostrMessageEvent of kind 14", async () => {
    const store = new FakeStore();
    const client = new FakeClient(store);
    const adapter = makeAdapter(client);
    const seen = recording(adapter);
    await adapter.connect();
    client.push(giftFromPeer("hello bot"));
    await until(() => seen.length === 1, "one event");

    const event = seen[0];
    expect(event?.platform).toBe("nostr");
    if (event?.platform !== "nostr") throw new Error("unreachable");
    expect(event.text).toBe("hello bot");
    expect(event.channel).toEqual({ id: peerPub, type: "dm" });
    expect(event.nostr.kind).toBe(14);
    expect(event.nostr.pubkey).toBe(peerPub);
  });

  it("decrypts a NIP-04 kind 4 message into one event of kind 4", async () => {
    const client = new FakeClient(new FakeStore());
    const adapter = makeAdapter(client);
    const seen = recording(adapter);
    await adapter.connect();
    client.push(legacy(peerKey, "legacy", START + 5));
    await until(() => seen.length === 1, "one event");

    expect(seen[0]?.text).toBe("legacy");
    expect(seen[0]?.platform === "nostr" && seen[0].nostr.kind).toBe(4);
  });

  it("produces no event for a message the bot's own key wrote", async () => {
    const client = new FakeClient(new FakeStore());
    const adapter = makeAdapter(client);
    const seen = recording(adapter);
    await adapter.connect();
    const own = sealDirectMessage(botKey, botPub, peerPub, "my own reply");
    client.push(own.toSelf);
    client.push(legacy(botKey, "own", START + 5));
    await drain();

    expect(seen).toEqual([]);
  });

  it("drops the bot's own NIP-17 self-copy by the rumor's pubkey, not the wrap's (EC-4)", async () => {
    const client = new FakeClient(new FakeStore());
    const adapter = makeAdapter(client);
    const seen = recording(adapter);
    await adapter.connect();
    const own = sealDirectMessage(botKey, botPub, peerPub, "self copy");
    expect(own.toSelf.pubkey).not.toBe(botPub);
    client.push(own.toSelf);
    await drain();

    expect(seen).toEqual([]);
  });

  it("drops a gift wrap whose rumor author differs from its seal's (EC-5)", async () => {
    const client = new FakeClient(new FakeStore());
    const adapter = makeAdapter(client);
    const seen = recording(adapter);
    await adapter.connect();
    const forged = createRumor(
      { kind: 14, content: "forged", tags: [["p", botPub]], created_at: START + 10 },
      peerKey,
    );
    const mallory = generateSecretKey();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    client.push(createWrap(createSeal(forged, mallory, botPub), botPub));
    await drain();

    expect(seen).toEqual([]);
  });

  it("does not answer a stored gift wrap again after a restart", async () => {
    const store = new FakeStore();
    const first = new FakeClient(store);
    const a = makeAdapter(first);
    const answered: string[] = [];
    a.onInbound(async (event) => {
      answered.push(event.text);
    });
    await a.connect();
    first.push(giftFromPeer("before restart", START + 10));
    await until(() => answered.length === 1, "adapter A answers");

    const second = new FakeClient(store);
    const b = makeAdapter(second, START + 100);
    const handler = vi.fn(async () => undefined);
    b.onInbound(handler);
    const sendSpy = vi.spyOn(b, "sendMessage");
    await b.connect();
    await drain();

    expect(handler).toHaveBeenCalledTimes(0);
    expect(sendSpy).toHaveBeenCalledTimes(0);
  });

  it("answers a wrap dated two days before ignoreBefore whose rumor is newer, before EOSE", async () => {
    const store = new FakeStore();
    store.events.push(giftFromPeer("newer rumor", START + 30, START - 172_000));
    const client = new FakeClient(store);
    const adapter = makeAdapter(client);
    const seen = recording(adapter);
    await adapter.connect();
    await until(() => seen.length === 1, "the backdated wrap");

    expect(seen[0]?.text).toBe("newer rumor");
  });

  it("drops a kind 4 message older than ignoreBefore", async () => {
    const client = new FakeClient(new FakeStore());
    const adapter = makeAdapter(client);
    const seen = recording(adapter);
    await adapter.connect();
    client.push(legacy(peerKey, "old", START - 1));
    await drain();

    expect(seen).toEqual([]);
  });

  it("delivers two different wraps of one rumor once", async () => {
    const client = new FakeClient(new FakeStore());
    const adapter = makeAdapter(client);
    const seen = recording(adapter);
    await adapter.connect();
    const rumor = createRumor(
      { kind: 14, content: "twice wrapped", tags: [["p", botPub]], created_at: START + 10 },
      peerKey,
    );
    client.push(createWrap(createSeal(rumor, peerKey, botPub), botPub));
    client.push(createWrap(createSeal(rumor, peerKey, botPub), botPub));
    await drain();

    expect(seen).toHaveLength(1);
  });

  it("delivers 20 concurrent wraps 20 times, and the same 20 again 0 times", async () => {
    const client = new FakeClient(new FakeStore());
    const adapter = makeAdapter(client);
    const seen = recording(adapter);
    await adapter.connect();
    const wraps = Array.from({ length: 20 }, (_, i) => giftFromPeer(`m${i}`));
    await Promise.all(wraps.map(async (wrap) => client.push(wrap)));
    await until(() => seen.length === 20, "20 events");
    await Promise.all(wraps.map(async (wrap) => client.push(wrap)));
    await drain();

    expect(seen).toHaveLength(20);
  });

  it("subscribes to kind 1059 from at least two days before ignoreBefore, and kind 4 from it", async () => {
    const client = new FakeClient(new FakeStore());
    await makeAdapter(client).connect();

    const [wraps, legacy] = client.filters[0] ?? [];
    expect(wraps?.kinds).toEqual([1059]);
    expect(wraps?.since).toBeLessThanOrEqual(START - 172_800);
    expect(wraps?.["#p"]).toEqual([botPub]);
    expect(legacy).toMatchObject({ kinds: [4], since: START, "#p": [botPub] });
  });

  it("logs a throwing handler as handler threw and delivers the next event", async () => {
    const client = new FakeClient(new FakeStore());
    const adapter = makeAdapter(client);
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const texts: string[] = [];
    adapter.onInbound(async (event) => {
      texts.push(event.text);
      if (event.text === "boom") throw new Error("user code failed");
    });
    await adapter.connect();
    client.push(giftFromPeer("boom"));
    client.push(giftFromPeer("after"));
    await until(() => texts.length === 2, "both events");

    expect(written.join("")).toContain("handler threw");
    expect(texts).toEqual(["boom", "after"]);
  });
});

describe("NostrAdapter.sendMessage", () => {
  it("returns empty_text before checking the connection", async () => {
    const adapter = makeAdapter(new FakeClient(new FakeStore()));

    const result = await adapter.sendMessage({ channel: { id: peerPub, type: "dm" }, text: "" });

    expect(result.error?.code).toBe("empty_text");
  });

  it("replies to a NIP-04 sender with a kind 4 event", async () => {
    const store = new FakeStore();
    const client = new FakeClient(store);
    const adapter = makeAdapter(client);
    const seen = recording(adapter);
    await adapter.connect();
    client.push(legacy(peerKey, "hi", START + 5));
    await until(() => seen.length === 1, "the kind 4 message");

    const result = await adapter.sendMessage({
      channel: { id: peerPub, type: "dm" },
      text: "back",
    });

    expect(store.published).toHaveLength(1);
    expect(store.published[0]?.kind).toBe(4);
    expect(openNip04(store.published[0] as NostrEvent, peerKey).text).toBe("back");
    expect(result).toEqual({ ok: true, messageId: store.published[0]?.id });
  });

  it("replies to anyone else with two gift wraps, one of them to the bot itself", async () => {
    const store = new FakeStore();
    const adapter = makeAdapter(new FakeClient(store));
    await adapter.connect();

    const result = await adapter.sendMessage({
      channel: { id: peerPub, type: "dm" },
      text: "**hello**",
      format: "markdown",
    });

    expect(store.published.map((event) => event.kind)).toEqual([1059, 1059]);
    const toPeer = store.published.find((event) => event.tags.some((t) => t[1] === peerPub));
    const opened = openGiftWrap(toPeer as NostrEvent, peerKey);
    expect(opened.text).toBe("hello");
    expect(result).toEqual({ ok: true, messageId: opened.id });
  });

  it("is ok when the recipient's wrap is accepted and the self-copy refused, and not the reverse (EC-8)", async () => {
    const store = new FakeStore();
    const adapter = makeAdapter(new FakeClient(store));
    await adapter.connect();
    const isSelf = (event: NostrEvent): boolean => event.tags.some((t) => t[1] === botPub);
    store.answer = (event) =>
      isSelf(event) ? { ok: false, code: "relay_rejected", message: "nope" } : { ok: true };
    const accepted = await adapter.sendMessage({ channel: { id: peerPub, type: "dm" }, text: "a" });
    store.answer = (event) =>
      isSelf(event) ? { ok: true } : { ok: false, code: "relay_rejected", message: "blocked" };
    const refused = await adapter.sendMessage({ channel: { id: peerPub, type: "dm" }, text: "b" });

    expect(accepted.ok).toBe(true);
    expect(refused).toEqual({ ok: false, error: { code: "relay_rejected", message: "blocked" } });
  });

  it("refuses a channel id that is not a 64-hex public key before publishing", async () => {
    const store = new FakeStore();
    const adapter = makeAdapter(new FakeClient(store));
    await adapter.connect();

    const result = await adapter.sendMessage({
      channel: { id: "npub1nope", type: "dm" },
      text: "x",
    });

    expect(result.error?.code).toBe("invalid_channel");
    expect(store.published).toEqual([]);
  });
});

describe("NostrAdapter over the relay client", () => {
  it("connect resolves false within 10000 ms when no relay ever answers", async () => {
    vi.useFakeTimers();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const relays = new FakeRelays();
    const adapter = new NostrAdapter({
      secretKey: botHex,
      relays: ["wss://silent.example"],
      socketFactory: relays.factory,
    });
    let answer: boolean | undefined;
    void adapter.connect().then((ok) => {
      answer = ok;
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(answer).toBe(false);
    await adapter.disconnect();
  });

  it("sendMessage settles timeout after 30000 ms when no relay answers OK", async () => {
    vi.useFakeTimers();
    const relays = new FakeRelays();
    const adapter = new NostrAdapter({
      secretKey: botHex,
      relays: ["wss://quiet.example"],
      socketFactory: relays.factory,
    });
    const connecting = adapter.connect();
    await vi.advanceTimersByTimeAsync(0);
    const socket = relays.latest("wss://quiet.example");
    socket.accept();
    await vi.advanceTimersByTimeAsync(0);
    const req = socket.frames("REQ").at(-1) as unknown[];
    socket.push(["EOSE", req[1]]);
    await expect(connecting).resolves.toBe(true);
    let result: unknown;
    void adapter
      .sendMessage({ channel: { id: peerPub, type: "dm" }, text: "anyone?" })
      .then((r) => {
        result = r;
      });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
    await adapter.disconnect();
  });
});
