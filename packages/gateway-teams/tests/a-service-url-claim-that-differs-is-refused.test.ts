/**
 * AC-013: a token whose `serviceurl` claim does not match the activity's `serviceUrl` is refused,
 * whether the SDK compared it (installed 2.0.x path) or not (2.1.x Entra path, via an accepting
 * validator).
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import {
  acceptingValidatorModule,
  activityRequest,
  F5_BF_SERVICE_URL_DIFFERS,
  F6_ENTRA_NO_SERVICE_URL,
  signFixture,
} from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("a service url claim that differs", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("refuses a token whose serviceurl claim differs from the body on the installed SDK path", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const token = signFixture(ks, F5_BF_SERVICE_URL_DIFFERS.claims);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(JSON.stringify(res).includes(token)).toBe(false);
  });

  it.each([
    ["a token whose serviceurl claim differs from the body", F5_BF_SERVICE_URL_DIFFERS],
    ["an Entra-issued token that carries no serviceurl claim", F6_ENTRA_NO_SERVICE_URL],
  ])("refuses %s as serviceurl_mismatch through an accepting validator", async (_, fixture) => {
    ks = await startKeyServer();
    const { module } = acceptingValidatorModule();
    const tenant = fixture.tenantId === undefined ? {} : { tenantId: fixture.tenantId };
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
      ...tenant,
    });
    const token = signFixture(ks, fixture.claims);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: "serviceurl_mismatch" });
    expect(JSON.stringify(res).includes(token)).toBe(false);
  });
});
