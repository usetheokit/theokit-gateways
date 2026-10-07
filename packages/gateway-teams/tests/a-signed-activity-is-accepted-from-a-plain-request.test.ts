/**
 * AC-002: a token the published key signed is accepted from a plain Fetch `Request`. The key set is
 * read once by the verifier and once by the SDK's own key client (the cold-start cost ADR-0005
 * accepts), and a key-set outage at a cold start is `key_set_unavailable` until the next read the
 * verifier allows, 10 seconds later, rather than the end of the verifier.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

describe("a signed activity", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  it("accepts a token signed by the published key from a plain Request and returns the activity and its service url", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const activity = { type: "message", text: "hi", serviceUrl: SERVICE_URL, channelId: "msteams" };

    const res = await verify(activityRequest(ks.signToken({}), activity));

    expect(res).toEqual({
      ok: true,
      activity,
      token: { appId: CLIENT_ID, serviceUrl: SERVICE_URL },
    });
  });

  it("is exported from the package root", () => {
    expect(typeof teamsActivityVerifier).toBe("function");
  });

  it("reads the key set once in the verifier and once in the SDK for two activities signed with the same key", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });

    const r1 = await verify(activityRequest(ks.signToken({})));
    const afterFirst = ks.hits();
    const r2 = await verify(activityRequest(ks.signToken({})));

    expect([r1.ok, r2.ok]).toEqual([true, true]);
    expect([afterFirst, ks.hits()]).toEqual([2, 2]);
  });

  it("accepts again once 10 seconds have passed after the key set answered 503 at a cold start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    ks.failNext(503);

    const r1 = await verify(activityRequest(ks.signToken({})));
    vi.advanceTimersByTime(9_999);
    const early = await verify(activityRequest(ks.signToken({})));
    vi.advanceTimersByTime(1);
    const r2 = await verify(activityRequest(ks.signToken({})));

    expect(r1).toMatchObject({ ok: false, reason: "key_set_unavailable" });
    expect(early).toMatchObject({ ok: false, reason: "key_set_unavailable" });
    expect(r2.ok).toBe(true);
    expect(ks.hits()).toBe(3);
  });
});
