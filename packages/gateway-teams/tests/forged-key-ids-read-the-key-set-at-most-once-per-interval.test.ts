/**
 * A token's `kid` is chosen by whoever sent the request. The verifier looks it up in the key set it
 * read itself, reads that set at most once per 10 seconds whatever is sent, and checks the RS256
 * signature before the SDK is asked, so a forged `kid` never reaches a key client that would fetch
 * the set for it (ADR-0005).
 */

import { Buffer } from "node:buffer";
import { generateKeyPairSync, randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

const stray = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

/** What the verifier answers for the default activity a genuine token carries. */
const ACCEPTED = {
  ok: true,
  activity: { type: "message", serviceUrl: SERVICE_URL, channelId: "msteams" },
  token: { appId: CLIENT_ID, serviceUrl: SERVICE_URL },
};

/** A refusal of a token naming a key the held copy of the key set does not list. */
const UNLISTED = {
  ok: false,
  reason: "invalid_token",
  message: expect.stringContaining("the published key set, as last read, does not list"),
};

describe("forged key ids", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  async function verifierWithKeys() {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    ks = await startKeyServer();
    return { ks, verify: teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud }) };
  }

  /** An RS256 token under a fresh kid, signed by a key nobody publishes. */
  const forged = (ks: KeyServer) => ks.signToken({}, { kid: randomUUID(), key: stray });

  /** A three-segment token whose header is `header`, with a valid payload and no signature. */
  const withHeader = (ks: KeyServer, header: Record<string, unknown>) => {
    const [, payload] = ks.signToken({}).split(".");
    return `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${payload}.`;
  };

  it("spend no key-set read on a bearer that is not a JWT, names no string kid, or names no RS256", async () => {
    const { ks, verify } = await verifierWithKeys();
    const keyless = [
      "x",
      "a.b",
      "!!!.e30.",
      withHeader(ks, { alg: "RS256", typ: "JWT" }),
      withHeader(ks, { alg: "RS256", typ: "JWT", kid: 7 }),
      withHeader(ks, { alg: "RS256", typ: "JWT", kid: "" }),
      ks.signToken({}, { alg: "none", kid: randomUUID() }),
      ks.signToken({}, { alg: "HS256", kid: randomUUID() }),
      withHeader(ks, { typ: "JWT", kid: randomUUID() }),
    ];

    const refused = [];
    for (let i = 0; i < 4; i += 1) {
      for (const token of keyless) refused.push(await verify(activityRequest(token)));
    }
    const hitsAfterKeyless = ks.hits();
    for (let i = 0; i < 10; i += 1) await verify(activityRequest(forged(ks)));

    expect(refused.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
    expect([hitsAfterKeyless, ks.hits()]).toEqual([0, 1]);
  });

  it("read the key set once for 20 forged tokens with fresh kids in one minute", async () => {
    const { ks, verify } = await verifierWithKeys();

    const results = [];
    for (let i = 0; i < 20; i += 1) results.push(await verify(activityRequest(forged(ks))));

    expect(results.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
    expect(ks.hits()).toBe(1);
  });

  it("refuse a fresh kid with a message that names neither the kid nor the token", async () => {
    const { ks, verify } = await verifierWithKeys();
    for (let i = 0; i < 10; i += 1) await verify(activityRequest(forged(ks)));
    const token = forged(ks);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({
      ok: false,
      reason: "invalid_token",
      message: expect.stringContaining("the published key set, as last read, does not list"),
    });
    expect(JSON.stringify(res).includes(token)).toBe(false);
    expect(ks.hits()).toBe(1);
  });

  it("accept a genuine token whatever forged traffic preceded it", async () => {
    const { ks, verify } = await verifierWithKeys();
    const first = await verify(activityRequest(ks.signToken({})));
    const refused = [];
    for (let i = 0; i < 20; i += 1) refused.push(await verify(activityRequest(forged(ks))));

    const after = await verify(activityRequest(ks.signToken({})));

    expect([first, after]).toEqual([ACCEPTED, ACCEPTED]);
    expect(refused).toEqual(Array.from({ length: 20 }, () => UNLISTED));
  });

  it("accept a genuine token that arrives after forged tokens at a cold start", async () => {
    const { ks, verify } = await verifierWithKeys();
    const refused = [];
    for (let i = 0; i < 10; i += 1) refused.push(await verify(activityRequest(forged(ks))));

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toEqual(ACCEPTED);
    expect(refused).toEqual(Array.from({ length: 10 }, () => UNLISTED));
  });

  it("accept a token signed with a newly published key after forged tokens, once 10 seconds have passed", async () => {
    const { ks, verify } = await verifierWithKeys();
    const first = await verify(activityRequest(ks.signToken({})));
    for (let i = 0; i < 9; i += 1) await verify(activityRequest(forged(ks)));
    ks.rotate();
    vi.advanceTimersByTime(10_000);

    const rotated = await verify(activityRequest(ks.signToken({})));

    expect([first, rotated]).toEqual([ACCEPTED, ACCEPTED]);
  });

  it("read the published key set at most once per 10 seconds for fresh kids", async () => {
    const { ks, verify } = await verifierWithKeys();
    for (let i = 0; i < 10; i += 1) await verify(activityRequest(forged(ks)));

    const results = [];
    for (let i = 0; i < 20; i += 1) results.push(await verify(activityRequest(forged(ks))));
    const afterBurst = ks.hits();
    vi.advanceTimersByTime(9_999);
    results.push(await verify(activityRequest(forged(ks))));
    const beforeInterval = ks.hits();
    vi.advanceTimersByTime(1);
    results.push(await verify(activityRequest(forged(ks))));

    expect(results.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
    expect([afterBurst, beforeInterval, ks.hits()]).toEqual([1, 1, 2]);
  });

  it("accept a key published after the last read of the key set once 10 seconds have passed", async () => {
    const { ks, verify } = await verifierWithKeys();
    await verify(activityRequest(ks.signToken({})));
    for (let i = 0; i < 11; i += 1) await verify(activityRequest(forged(ks)));
    ks.rotate();

    vi.advanceTimersByTime(9_999);
    const early = await verify(activityRequest(ks.signToken({})));
    vi.advanceTimersByTime(1);
    const onTime = await verify(activityRequest(ks.signToken({})));

    // Within 10 s of the last read nothing reads the set again, so the new kid is not yet listed.
    expect(early).toEqual(UNLISTED);
    expect(onTime).toEqual(ACCEPTED);
  });

  it("share one key-set read among concurrent tokens", async () => {
    const { ks, verify } = await verifierWithKeys();
    for (let i = 0; i < 10; i += 1) await verify(activityRequest(forged(ks)));

    const results = await Promise.all(
      Array.from({ length: 5 }, () => verify(activityRequest(forged(ks)))),
    );

    expect(results.every((r) => !r.ok)).toBe(true);
    expect(ks.hits()).toBe(1);
  });

  it("share one key-set read among concurrent tokens at a cold start", async () => {
    const { ks, verify } = await verifierWithKeys();

    const results = await Promise.all([
      ...Array.from({ length: 4 }, () => verify(activityRequest(forged(ks)))),
      verify(activityRequest(ks.signToken({}))),
    ]);

    expect(results.map((r) => r.ok)).toEqual([false, false, false, false, true]);
    // One read by the verifier for all five, and one by the SDK for the genuine token.
    expect(ks.hits()).toBe(2);
  });

  it("say key_set_unavailable, and keep the set read before, when a read fails", async () => {
    const { ks, verify } = await verifierWithKeys();
    for (let i = 0; i < 11; i += 1) await verify(activityRequest(forged(ks)));
    vi.advanceTimersByTime(10_000);
    ks.failNext(503);

    const unreadable = await verify(activityRequest(forged(ks)));
    const genuine = await verify(activityRequest(ks.signToken({})));

    expect(unreadable).toMatchObject({ ok: false, reason: "key_set_unavailable" });
    expect(genuine.ok).toBe(true);
  });

  it("read the key set once for six genuine tokens and the forged tokens after them", async () => {
    const { ks, verify } = await verifierWithKeys();
    const accepted = [];
    for (let i = 0; i < 6; i += 1) accepted.push(await verify(activityRequest(ks.signToken({}))));
    for (let i = 0; i < 9; i += 1) await verify(activityRequest(forged(ks)));

    expect(accepted.every((r) => r.ok)).toBe(true);
    // One read by the verifier and one by the SDK's own key client, for the first genuine token.
    expect(ks.hits()).toBe(2);
  });

  it("accept a kid the last good copy lists when a later read fails", async () => {
    const { ks, verify } = await verifierWithKeys();
    await verify(activityRequest(ks.signToken({})));
    for (let i = 0; i < 9; i += 1) await verify(activityRequest(forged(ks)));
    vi.advanceTimersByTime(10_000);
    ks.failNext(503);
    const failedRead = await verify(activityRequest(forged(ks)));

    const res = await verify(activityRequest(ks.signToken({})));

    expect(failedRead).toMatchObject({ ok: false, reason: "key_set_unavailable" });
    expect(res.ok).toBe(true);
  });

  it("do not read the key set again for a kid it already lists", async () => {
    const { ks, verify } = await verifierWithKeys();
    const publishedKid = ks.rotate();
    const listedForgery = () => ks.signToken({}, { kid: publishedKid, key: stray });
    for (let i = 0; i < 10; i += 1) await verify(activityRequest(forged(ks)));
    await verify(activityRequest(listedForgery()));
    const afterFirst = ks.hits();
    vi.advanceTimersByTime(10_000);

    const res = await verify(activityRequest(listedForgery()));

    expect(res).toMatchObject({
      ok: false,
      reason: "invalid_token",
      message: expect.stringContaining("signature does not verify"),
    });
    expect([afterFirst, ks.hits()]).toEqual([1, 1]);
  });

  it("read the key set again once the copy is an hour old, so a retired key stops verifying", async () => {
    const { ks, verify } = await verifierWithKeys();
    const [retired] = ks.publishedKids() as [string];
    await verify(activityRequest(forged(ks)));
    const genuine = ks.signToken({});
    ks.rotate();
    ks.retire(retired);
    vi.advanceTimersByTime(60 * 60 * 1000 - 1);
    await verify(activityRequest(ks.signToken({}, { kid: retired, key: stray })));
    const stillHeld = ks.hits();
    vi.advanceTimersByTime(1);
    // Answered from the hour-old copy; it starts the read in the background.
    await verify(activityRequest(ks.signToken({}, { kid: retired, key: stray })));
    // A kid the copy lacks waits for that read, so the read has completed after it.
    await verify(activityRequest(forged(ks)));

    const res = await verify(activityRequest(genuine));

    expect(res).toMatchObject({
      ok: false,
      reason: "invalid_token",
      message: expect.stringContaining("does not list"),
    });
    expect([stillHeld, ks.hits()]).toEqual([1, 2]);
  });

  it("say key_set_unavailable when the key set answers with no keys array", async () => {
    const { ks, verify } = await verifierWithKeys();
    ks.answerNext({ keys: "not-an-array" });

    const res = await verify(activityRequest(forged(ks)));

    expect(res).toMatchObject({ ok: false, reason: "key_set_unavailable" });
  });

  it("say key_set_unavailable when the key set lists more than 1000 keys", async () => {
    const { ks, verify } = await verifierWithKeys();
    const [jwk] = ks.publishedJwks();
    ks.answerNext({ keys: Array.from({ length: 1001 }, (_, i) => ({ ...jwk, kid: `k${i}` })) });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({ ok: false, reason: "key_set_unavailable" });
  });

  it("say key_set_unavailable when the key set is larger than 1 MiB", async () => {
    const { ks, verify } = await verifierWithKeys();
    ks.answerNext({ keys: ks.publishedJwks(), padding: "x".repeat(1024 * 1024) });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({ ok: false, reason: "key_set_unavailable" });
  });

  it("list the RSA keys a key set holds, past entries with no usable kid or key", async () => {
    const { ks, verify } = await verifierWithKeys();
    const rotated = ks.rotate();
    const rotatedJwk = ks.publishedJwks().find((jwk) => jwk.kid === rotated);
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({
      format: "jwk",
    });
    ks.answerNext({
      keys: [
        null,
        { kid: 7 },
        { kid: "" },
        {},
        { kid: "no-material" },
        { ...ec, kid: "ec" },
        rotatedJwk,
      ],
    });

    const res = await verify(activityRequest(ks.signToken({})));
    const unlisted = await verify(activityRequest(ks.signToken({}, { kid: "no-material" })));

    expect(res).toEqual(ACCEPTED);
    // The entries skipped are not listed: a kid only a skipped entry named is a key nobody publishes.
    expect(unlisted).toEqual(UNLISTED);
  });

  it("refuse a token naming a published EC key without asking the SDK", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    ks = await startKeyServer();
    let checks = 0;
    class CountingValidator {
      async check(_header: string, body: { serviceUrl: string }) {
        checks += 1;
        return { appId: CLIENT_ID, serviceUrl: body.serviceUrl };
      }
    }
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: { InboundActivityTokenValidator: CountingValidator },
    });
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    // Published beside the RSA keys: a document listing only the EC key lists no usable RSA key,
    // which is a failed read (key_set_unavailable), not the listed-but-unusable case this covers.
    ks.answerNext({
      keys: [...ks.publishedJwks(), { ...ec.publicKey.export({ format: "jwk" }), kid: "ec" }],
    });

    const res = await verify(activityRequest(ks.signToken({}, { kid: "ec", key: ec.privateKey })));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(checks).toBe(0);
  });
});
