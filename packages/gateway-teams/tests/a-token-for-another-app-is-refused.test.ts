/**
 * AC-014: a token issued for another app id is refused, whether the SDK checked the audience
 * (installed path) or a validator would have accepted it anyway: its signature verified, so the
 * verifier refuses it on its audience before any validator is asked (loop-code-review LCR0103).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  acceptingValidatorModule,
  activityRequest,
  F7_BF_OTHER_APP,
  signFixture,
} from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";
import { verifierUnderTest } from "./helpers/verifier-under-test.js";
// Loaded at collection, outside any test's budget: the first verified request used to pay the SDK middleware's first import inside its own 5 s (B-545).
import "@microsoft/teams.apps/dist/middleware/index.js";

describe("a token for another app", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("refuses a token issued for another app id on the installed SDK path as invalid_token", async () => {
    ks = await startKeyServer();
    const verify = verifierUnderTest({ clientId: CLIENT_ID, cloud: ks.cloud });
    const token = signFixture(ks, F7_BF_OTHER_APP.claims);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(JSON.stringify(res).includes(token)).toBe(false);
  });

  it("refuses it as invalid_token before an accepting validator is asked", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const verify = verifierUnderTest({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      validatorModule: module,
    });
    const token = signFixture(ks, F7_BF_OTHER_APP.claims);

    const res = await verify(activityRequest(token));

    expect([res, calls.check]).toMatchObject([{ ok: false, reason: "invalid_token" }, 0]);
    expect(JSON.stringify(res).includes(token)).toBe(false);
  });
});
