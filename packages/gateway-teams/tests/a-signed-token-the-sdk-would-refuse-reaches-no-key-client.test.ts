/**
 * The SDK's key client fetches the key set before it checks a token's audience or expiry, and
 * caches only 5 keys. So a token validly signed under a published key, but issued for another app
 * or out of the SDK's 300-second clock tolerance, is refused by the verifier before the SDK is
 * asked, and never makes the SDK read the key set again (B-420, loop-code-review LCR0103).
 */

import * as sdk20 from "@microsoft/teams.apps/dist/middleware/index.js";
import * as sdk21 from "@microsoft/teams.apps-2-1/dist/middleware/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";
import { verifierUnderTest } from "./helpers/verifier-under-test.js";

const OTHER_APP = "00000000-0000-0000-0000-0000000000b2";
const SDKS = [
  { sdk: "2.0.x", module: sdk20 as unknown },
  { sdk: "2.1.x", module: sdk21 as unknown },
] as const;

const now = () => Math.floor(Date.now() / 1000);

describe.each(SDKS)("a signed token the SDK would refuse, on SDK $sdk", ({ module }) => {
  let ks: KeyServer | undefined;

  // A frozen clock, so a claim 299 or 301 seconds off cannot cross the 300-second edge mid-test.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  async function verifierOn() {
    ks = await startKeyServer({ extraKeys: 7 });
    const verify = verifierUnderTest({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      validatorModule: module,
    });
    return { ks, verify };
  }

  it("reads the key set once for 30 tokens for another app, expired or not yet valid, cycling through 8 listed kids", async () => {
    const { ks, verify } = await verifierOn();
    const kids = ks.publishedKids();
    const disqualified = [
      { aud: OTHER_APP },
      { aud: [OTHER_APP] },
      { exp: now() - 300 },
      { nbf: now() + 301 },
      { exp: "never" },
    ];

    const results = [];
    for (let i = 0; i < 30; i += 1) {
      const kid = kids[i % kids.length] as string;
      const claims = disqualified[i % disqualified.length] as Record<string, unknown>;
      results.push(await verify(activityRequest(ks.signWithKid(kid, claims))));
    }

    expect(kids.length).toBe(8);
    expect(results.filter((r) => !r.ok && r.reason === "invalid_token")).toHaveLength(30);
    expect(ks.hits()).toBe(1);
  });

  it("still asks the SDK about a token expired by less than 300 seconds, and accepts it", async () => {
    const { ks, verify } = await verifierOn();

    const res = await verify(activityRequest(ks.signToken({ exp: now() - 299 })));

    expect(res).toMatchObject({ ok: true });
    expect(ks.hits()).toBe(2);
  });

  it("still asks the SDK about a token whose aud array names this app, and refuses it as audience_mismatch", async () => {
    const { ks, verify } = await verifierOn();

    const res = await verify(activityRequest(ks.signToken({ aud: [OTHER_APP, CLIENT_ID] })));

    expect(res).toMatchObject({ ok: false, reason: "audience_mismatch" });
    expect(ks.hits()).toBe(2);
  });
});
