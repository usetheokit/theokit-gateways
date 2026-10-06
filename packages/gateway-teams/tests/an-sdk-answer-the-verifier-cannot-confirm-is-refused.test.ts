/**
 * The verifier accepts only what it can confirm on its own after the SDK answered: a resolved token
 * with both a string `appId` and a string `serviceUrl`, and a raw token whose payload decodes to
 * claims. Anything less is a typed refusal, never an exception and never an acceptance.
 */

import { Buffer } from "node:buffer";

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

function resolvingValidatorModule(result: unknown) {
  return {
    InboundActivityTokenValidator: class {
      async check() {
        return result;
      }
    },
  };
}

describe("an SDK answer the verifier cannot confirm", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("refuses as invalid_token when the SDK accepts a token whose payload does not decode", async () => {
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, __validatorModule: module });
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");

    const res = await verify(activityRequest(`${header}.!!!.c`));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(calls.check).toBe(1);
  });

  it.each([
    ["an appId and no serviceUrl", { appId: CLIENT_ID }],
    ["a serviceUrl and no appId", { serviceUrl: SERVICE_URL }],
    ["an appId and a serviceUrl that is not a string", { appId: CLIENT_ID, serviceUrl: 42 }],
  ])("refuses as invalid_token when the SDK resolves %s", async (_, result) => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      __validatorModule: resolvingValidatorModule(result),
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
  });

  it("recognises a token issued by the configured cloud's login endpoint as tenant-issued", async () => {
    ks = await startKeyServer();
    const { module } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
    });
    const token = ks.signToken({ iss: `${ks.cloud.loginEndpoint}/some-tenant/v2.0` });

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: "tenant_unverified" });
  });
});
