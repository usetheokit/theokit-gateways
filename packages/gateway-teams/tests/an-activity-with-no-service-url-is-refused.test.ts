/**
 * AC-012: an activity with no usable `serviceUrl` is refused before the SDK validator is called,
 * since there is nothing to bind the token's `serviceurl` claim to.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("an activity with no service url", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("refuses an activity with no serviceUrl as malformed_body with 0 validator calls", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, __validatorModule: module });

    const res = await verify(activityRequest(ks.signToken({}), { type: "message" }));

    expect(res).toMatchObject({ ok: false, reason: "malformed_body" });
    expect(calls.check).toBe(0);
  });

  it("refuses an activity whose serviceUrl is an empty string as malformed_body with 0 validator calls", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, __validatorModule: module });

    const res = await verify(
      activityRequest(ks.signToken({}), { type: "message", serviceUrl: "" }),
    );

    expect(res).toMatchObject({ ok: false, reason: "malformed_body" });
    expect(calls.check).toBe(0);
  });
});
