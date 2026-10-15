/**
 * A key Microsoft retired must not become a way to make the bot fetch the key set. The verifier
 * learns nothing from an accepted token: it checks a token against the key set it last read, so a
 * forged token naming a retired key costs no outbound request after the SDK's cache forgot that
 * key (the SDK's key client keeps a key for 10 minutes) (B-420).
 */

import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

/** The SDK key client's cache age: `jwks-rsa`'s default `cacheMaxAge`. */
const SDK_KEY_CACHE_AGE_MS = 600_000;

describe("a key Microsoft stopped publishing", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  it("adds at most one key-set request for 20 forged tokens naming it", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const [retired] = ks.publishedKids() as [string];
    const genuine = await verify(activityRequest(ks.signToken({})));
    ks.rotate();
    ks.retire(retired);
    vi.advanceTimersByTime(SDK_KEY_CACHE_AGE_MS + 1);
    const stray = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const before = ks.hits();

    const results = [];
    for (let i = 0; i < 20; i += 1) {
      results.push(await verify(activityRequest(ks.signToken({}, { kid: retired, key: stray }))));
    }

    expect(genuine.ok).toBe(true);
    expect(results.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
    expect(ks.hits() - before).toBeLessThanOrEqual(1);
  });
});
