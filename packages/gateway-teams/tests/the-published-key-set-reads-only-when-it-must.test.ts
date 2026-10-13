/**
 * `keySet` decides when a published key set is read: a held key is answered at once, a missing one
 * waits for a read, concurrent lookups share it, no read starts within 10 s of the previous one, a
 * failed read keeps the last good copy, and an hour-old copy is read again in the background. Driven
 * by a stubbed `fetch` and a fake monotonic clock, with no socket.
 */

import { generateKeyPairSync } from "node:crypto";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { keySet, keySetUrl, tenantKeySetUrl } from "../src/published-key-set.js";

const URL_ = "https://keys.example/keys";
const HOUR_MS = 60 * 60 * 1000;

let jwkA: Record<string, unknown>;
let jwkB: Record<string, unknown>;

/** A fetch stub answering each call with the next queued response, counting the calls. */
function stubFetch(): { answer(response: () => Response): void; calls: () => number } {
  const queue: (() => Response)[] = [];
  let calls = 0;
  vi.stubGlobal("fetch", async () => {
    calls += 1;
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected key-set read");
    return next();
  });
  return { answer: (response) => queue.push(response), calls: () => calls };
}

const keysDocument =
  (...keys: Record<string, unknown>[]) =>
  () =>
    new Response(JSON.stringify({ keys }), { status: 200 });

describe("keySet", () => {
  beforeAll(() => {
    const exportJwk = () =>
      generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" });
    jwkA = { ...exportJwk(), kid: "a" };
    jwkB = { ...exportJwk(), kid: "b" };
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads the set on the first lookup and answers the key", async () => {
    const fetch = stubFetch();
    fetch.answer(keysDocument(jwkA));
    const set = keySet("Bot Framework", URL_);

    const found = await set.lookup("a");

    expect(found).toMatchObject({ publicKey: { asymmetricKeyType: "rsa" } });
    expect(fetch.calls()).toBe(1);
  });

  it("answers a key with the channels its entry endorses", async () => {
    const fetch = stubFetch();
    fetch.answer(keysDocument({ ...jwkA, endorsements: ["msteams", 7, "webchat"] }));
    const set = keySet("Bot Framework", URL_);

    const found = await set.lookup("a");

    expect(found).toMatchObject({ endorsements: ["msteams", "webchat"] });
  });

  it("answers a key whose entry has no endorsements array with none", async () => {
    const fetch = stubFetch();
    fetch.answer(keysDocument({ ...jwkA, endorsements: "msteams" }));
    const set = keySet("Bot Framework", URL_);

    const found = await set.lookup("a");

    expect(found).toMatchObject({ endorsements: undefined });
  });

  it("shares one read between concurrent lookups", async () => {
    const fetch = stubFetch();
    fetch.answer(keysDocument(jwkA));
    const set = keySet("Bot Framework", URL_);

    await Promise.all([set.lookup("a"), set.lookup("a"), set.lookup("b")]);

    expect(fetch.calls()).toBe(1);
  });

  it("answers a held key without reading again", async () => {
    const fetch = stubFetch();
    fetch.answer(keysDocument(jwkA));
    const set = keySet("Bot Framework", URL_);
    await set.lookup("a");

    await set.lookup("a");

    expect(fetch.calls()).toBe(1);
  });

  it("answers unlisted for a kid a successful read did not list", async () => {
    const fetch = stubFetch();
    fetch.answer(keysDocument(jwkA));
    const set = keySet("Bot Framework", URL_);

    await expect(set.lookup("b")).resolves.toBe("unlisted");
  });

  it("starts no read within 10 s of the previous one", async () => {
    const fetch = stubFetch();
    fetch.answer(keysDocument(jwkA));
    fetch.answer(keysDocument(jwkA, jwkB));
    const set = keySet("Bot Framework", URL_);
    await set.lookup("a");

    vi.advanceTimersByTime(9_999);
    await expect(set.lookup("b")).resolves.toBe("unlisted");
    vi.advanceTimersByTime(1);
    const found = await set.lookup("b");

    expect(found).toMatchObject({ publicKey: { asymmetricKeyType: "rsa" } });
    expect(fetch.calls()).toBe(2);
  });

  it("answers unavailable, naming the set and why its read failed", async () => {
    const fetch = stubFetch();
    fetch.answer(() => new Response("busy", { status: 503 }));
    const set = keySet("Bot Framework", URL_);

    const found = await set.lookup("a");

    expect(found).toEqual({
      unavailable: expect.stringContaining(`Bot Framework key set at ${URL_}: HTTP 503`),
    });
  });

  it("keeps the last good copy when a later read fails", async () => {
    const fetch = stubFetch();
    fetch.answer(keysDocument(jwkA));
    fetch.answer(() => new Response("not json", { status: 200 }));
    const set = keySet("Bot Framework", URL_);
    await set.lookup("a");
    vi.advanceTimersByTime(10_000);

    const missing = await set.lookup("b");
    const held = await set.lookup("a");

    expect(missing).toEqual({ unavailable: expect.stringContaining("the document is not JSON") });
    expect(held).toMatchObject({ publicKey: { asymmetricKeyType: "rsa" } });
  });

  it("answers an hour-old key at once and reads the set again in the background", async () => {
    const fetch = stubFetch();
    fetch.answer(keysDocument(jwkA));
    fetch.answer(keysDocument(jwkB));
    const set = keySet("Bot Framework", URL_);
    await set.lookup("a");
    vi.advanceTimersByTime(HOUR_MS);

    const stale = await set.lookup("a");
    // "b" is only in the background read's document, so this lookup waits for that read.
    const rotated = await set.lookup("b");

    expect(stale).toMatchObject({ publicKey: { asymmetricKeyType: "rsa" } });
    expect(rotated).toMatchObject({ publicKey: { asymmetricKeyType: "rsa" } });
    expect(fetch.calls()).toBe(2);
    await expect(set.lookup("a")).resolves.toBe("unlisted");
  });

  it("does not read again for a key younger than an hour", async () => {
    const fetch = stubFetch();
    fetch.answer(keysDocument(jwkA));
    const set = keySet("Bot Framework", URL_);
    await set.lookup("a");
    vi.advanceTimersByTime(HOUR_MS - 1);

    await set.lookup("a");

    expect(fetch.calls()).toBe(1);
  });
});

describe("key-set URLs", () => {
  it("derives the Bot Framework set from the metadata URL as the SDK does", () => {
    expect(keySetUrl("https://login.example/v1/.well-known/openidconfiguration")).toBe(
      "https://login.example/v1/.well-known/keys",
    );
    expect(keySetUrl(undefined)).toBe("https://login.botframework.com/v1/.well-known/keys");
  });

  it("derives a tenant's set under the login endpoint", () => {
    expect(tenantKeySetUrl("https://login.microsoftonline.com", "t-id")).toBe(
      "https://login.microsoftonline.com/t-id/discovery/v2.0/keys",
    );
  });
});
