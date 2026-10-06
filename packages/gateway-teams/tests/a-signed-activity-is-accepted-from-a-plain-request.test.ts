/**
 * AC-002: a token the published key signed is accepted from a plain Fetch `Request`, the key set
 * is fetched once per verifier, and a key-set outage costs one request rather than the verifier.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

describe("a signed activity", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("accepts a token signed by the published key from a plain Request and returns the activity and its service url", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const activity = { type: "message", text: "hi", serviceUrl: SERVICE_URL };

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

  it("fetches the key set once for two activities signed with the same key", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });

    const r1 = await verify(activityRequest(ks.signToken({})));
    const r2 = await verify(activityRequest(ks.signToken({})));

    expect([r1.ok, r2.ok]).toEqual([true, true]);
    expect(ks.hits()).toBe(1);
  });

  it("accepts again after the key set answered 503 once", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    ks.failNext(503);

    const r1 = await verify(activityRequest(ks.signToken({})));
    const r2 = await verify(activityRequest(ks.signToken({})));

    expect(r1).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(r2.ok).toBe(true);
    expect(ks.hits()).toBe(2);
  });
});
