/**
 * The Bot Framework publishes one key set for every channel and binds each key to the channels it
 * may sign for through the key's `endorsements`. The activity's `channelId` is written by whoever
 * signed the token, so checking it binds nothing: a key endorsed only for another channel could
 * sign an activity that says `msteams`. A Bot Framework key whose `endorsements` do not list the
 * activity's channel is `invalid_token`, before the SDK is asked (loop-code-review LCR0133). A
 * tenant (Entra) key carries no `endorsements` and is not judged by them.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest, TENANT } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";
import { verifierUnderTest } from "./helpers/verifier-under-test.js";
// Loaded at collection, outside any test's budget: the first verified request used to pay the SDK middleware's first import inside its own 5 s (B-545).
import "@microsoft/teams.apps/dist/middleware/index.js";

const TEAMS_ACTIVITY = { type: "message", serviceUrl: SERVICE_URL, channelId: "msteams" };

describe("a Bot Framework key not endorsed for Teams", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("refuses an msteams activity signed by a key endorsed only for another channel", async () => {
    ks = await startKeyServer();
    const kid = ks.publishKey(["conversationconductorivr"]);
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });

    const res = await verify(activityRequest(ks.signWithKid(kid, {}), TEAMS_ACTIVITY));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(res.ok ? "" : res.message).toContain("not endorsed for the activity's channel");
  });

  it("refuses an msteams activity signed by a key that lists no endorsements", async () => {
    ks = await startKeyServer();
    const kid = ks.publishKey(null);
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });

    const res = await verify(activityRequest(ks.signWithKid(kid, {}), TEAMS_ACTIVITY));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(res.ok ? "" : res.message).toContain("not endorsed for the activity's channel");
  });

  it("accepts an msteams activity signed by a key endorsed for msteams among other channels", async () => {
    ks = await startKeyServer();
    const kid = ks.publishKey(["webchat", "msteams", "directline"]);
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });

    const res = await verify(activityRequest(ks.signWithKid(kid, {}), TEAMS_ACTIVITY));

    expect(res).toEqual({
      ok: true,
      activity: TEAMS_ACTIVITY,
      token: { appId: CLIENT_ID, serviceUrl: SERVICE_URL },
    });
  });

  it("leaves a Web Chat activity signed by a Web Chat key to the channel check", async () => {
    ks = await startKeyServer();
    const kid = ks.publishKey(["webchat"]);
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const activity = { type: "message", serviceUrl: SERVICE_URL, channelId: "webchat" };

    const res = await verify(activityRequest(ks.signWithKid(kid, {}), activity));

    expect(res).toMatchObject({ ok: false, reason: "channel_mismatch" });
  });
});

describe("a tenant key, which carries no endorsements", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("still signs an accepted tenant-issued msteams activity", async () => {
    ks = await startKeyServer({ separateTenantKeys: true });
    const verify = verifierUnderTest({
      clientId: CLIENT_ID,
      tenantId: TENANT,
      cloud: ks.cloud,
      validatorModule: acceptingValidatorModule().module,
    });
    const token = ks.signTenantToken({
      iss: `${ks.cloud.loginEndpoint}/${TENANT}/v2.0`,
      tid: TENANT,
    });

    const res = await verify(activityRequest(token, TEAMS_ACTIVITY));

    expect(res).toMatchObject({ ok: true, activity: TEAMS_ACTIVITY });
  });
});
