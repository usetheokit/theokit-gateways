/**
 * Whatever an unauthenticated sender sends, each key set is read at most once per 10 seconds:
 * fresh kids, listed kids with a bad signature, the configured tenant or a foreign one (B-420).
 */

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest, OTHER_TENANT, TENANT } from "./helpers/claim-fixtures.js";
import { INSTALLED_SDK_LINE } from "./helpers/installed-sdk.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";
// Loaded at collection, outside the test's budget: the first verified request used to pay the SDK middleware's first import inside it (B-533).
import "@microsoft/teams.apps/dist/middleware/index.js";

describe("key-set reads", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  it("stay at one per set for 1000 mixed forged requests inside 10 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    ks = await startKeyServer({ extraKeys: 7 });
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      tenantId: TENANT,
      cloud: ks.cloud,
    });
    const kids = ks.publishedKids();
    const entra = (tid: string) => ({ iss: `${ks?.cloud.loginEndpoint}/${tid}/v2.0`, tid });

    const results = [];
    for (let i = 0; i < 1000; i += 1) {
      const listed = kids[i % kids.length] as string;
      const kid = i % 2 === 0 ? listed : randomUUID();
      const claims = [{ tid: TENANT }, entra(TENANT), entra(OTHER_TENANT), entra(randomUUID())][
        i % 4
      ] as Record<string, unknown>;
      results.push(await verify(activityRequest(ks.forgeToken(claims, { kid }))));
    }

    expect(results.every((r) => !r.ok)).toBe(true);
    // SDK 2.0.x cannot accept a tenant-issued token: the verifier refuses those before reading the
    // tenant's set, so only the Bot Framework set is read. 2.1.x reads the tenant's set once.
    const tenantReads = INSTALLED_SDK_LINE === "2.0.x" ? 0 : 1;
    expect([ks.hits(), ks.tenantHits(TENANT)]).toEqual([1, tenantReads]);
  }, 30_000);
});
