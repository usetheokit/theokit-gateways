/**
 * A sender can copy any `kid` from Microsoft's published key set, and the SDK's key client caches
 * only 5 keys. So a forged token naming a listed key is checked by the verifier against the key it
 * read itself, and never reaches a key client that would fetch the set again for it (B-420).
 */

import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("a forged token naming a published key", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  it("reads the key set once for 30 forged tokens cycling through 8 listed kids", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    ks = await startKeyServer({ extraKeys: 7 });
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const kids = ks.publishedKids();
    const stray = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

    const results = [];
    for (let i = 0; i < 30; i += 1) {
      const kid = kids[i % kids.length] as string;
      const token =
        i % 2 === 0
          ? ks.signToken({}, { kid, key: stray })
          : ks.signToken({}, { kid, alg: "none" });
      results.push(await verify(activityRequest(token)));
    }

    expect(kids.length).toBe(8);
    expect(results.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
    expect(ks.hits()).toBe(1);
  });
});
