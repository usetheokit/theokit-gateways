/**
 * Once a held key set is an hour old the verifier reads it again, so a key Microsoft retired stops
 * verifying. A token whose `kid` the old copy lists is answered from that copy while the read runs
 * in the background, so a key endpoint that hangs adds no wait to it; only a token whose `kid` the
 * copy lacks waits for a read. A read that ends, however it ends, is followed by no other read for
 * the read interval, so an endpoint that hangs until the read times out cannot drive reads back to
 * back (B-420, ADR-0005).
 */

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

const HOUR_MS = 60 * 60 * 1000;

/** What a verify still waiting after this much real time is reported as. */
const STILL_WAITING = "still waiting on the key-set read";

function within(ms: number, pending: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    pending,
    new Promise((resolve) => {
      setTimeout(() => resolve(STILL_WAITING), ms);
    }),
  ]);
}

describe("a key set an hour old", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  /** A verifier holding a copy read at 12:00, with the SDK stood in so only the verifier reads. */
  async function warmVerifier() {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: acceptingValidatorModule().module,
    });
    const warm = await verify(activityRequest(ks.signToken({})));
    expect([warm.ok, ks.hits()]).toEqual([true, 1]);
    return { ks, verify };
  }

  const unlisted = (ks: KeyServer) => ks.signToken({}, { kid: randomUUID() });

  it("answers a token whose kid the copy lists without waiting for a refresh the endpoint never answers", async () => {
    const { ks, verify } = await warmVerifier();
    vi.advanceTimersByTime(HOUR_MS);
    ks.holdNext();

    const res = await within(1_000, verify(activityRequest(ks.signToken({}))));

    expect(res).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(ks.hits()).toBe(2));
  });

  it("starts one refresh for every request that finds the copy an hour old while it runs", async () => {
    const { ks, verify } = await warmVerifier();
    vi.advanceTimersByTime(HOUR_MS);
    ks.holdNext();

    const results = await within(
      1_000,
      Promise.all(Array.from({ length: 5 }, () => verify(activityRequest(ks.signToken({}))))),
    );
    await vi.waitFor(() => expect(ks.hits()).toBe(2));

    expect(results).toEqual(Array.from({ length: 5 }, () => expect.objectContaining({ ok: true })));
    expect(ks.hits()).toBe(2);
  });

  it("makes a token whose kid the copy lacks wait for the refresh in flight and see its result", async () => {
    const { ks, verify } = await warmVerifier();
    const added = ks.rotate();
    vi.advanceTimersByTime(HOUR_MS);
    const answer = ks.holdNext();
    await verify(activityRequest(ks.signWithKid(ks.publishedKids()[0] as string, {})));
    await vi.waitFor(() => expect(ks.hits()).toBe(2));

    const waiting = verify(activityRequest(ks.signWithKid(added, {})));
    const before = await within(200, waiting);
    answer();

    expect([before, await waiting]).toEqual([STILL_WAITING, expect.objectContaining({ ok: true })]);
    expect(ks.hits()).toBe(2);
  });

  it("starts no read for an interval after a read that hung for the whole interval and failed", async () => {
    const { ks, verify } = await warmVerifier();
    vi.advanceTimersByTime(HOUR_MS);
    const answer = ks.holdNext();
    const firstUnlisted = verify(activityRequest(unlisted(ks)));
    await vi.waitFor(() => expect(ks.hits()).toBe(2));
    vi.advanceTimersByTime(10_000);
    answer(503);
    const failed = await firstUnlisted;

    const atEnd = await verify(activityRequest(unlisted(ks)));
    const hitsAtEnd = ks.hits();
    vi.advanceTimersByTime(9_999);
    await verify(activityRequest(ks.signToken({})));
    await verify(activityRequest(unlisted(ks)));
    const hitsBeforeInterval = ks.hits();
    vi.advanceTimersByTime(1);
    await verify(activityRequest(unlisted(ks)));

    expect([failed, atEnd]).toEqual([
      expect.objectContaining({ ok: false, reason: "key_set_unavailable" }),
      expect.objectContaining({ ok: false, reason: "key_set_unavailable" }),
    ]);
    expect([hitsAtEnd, hitsBeforeInterval, ks.hits()]).toEqual([2, 2, 3]);
  });

  it("keeps answering from the copy, with no unhandled rejection, when the refresh is dropped", async () => {
    const { ks: server, verify } = await warmVerifier();
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      vi.advanceTimersByTime(HOUR_MS);
      server.holdNext();
      const listed = await verify(activityRequest(server.signToken({})));
      await vi.waitFor(() => expect(server.hits()).toBe(2));
      const later = server.signToken({});
      const missing = unlisted(server);
      ks = undefined;
      await server.close();

      const joined = await verify(activityRequest(missing));
      const fromCopy = await verify(activityRequest(later));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect([listed.ok, joined, fromCopy.ok]).toEqual([
        true,
        expect.objectContaining({ ok: false, reason: "key_set_unavailable" }),
        true,
      ]);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});
