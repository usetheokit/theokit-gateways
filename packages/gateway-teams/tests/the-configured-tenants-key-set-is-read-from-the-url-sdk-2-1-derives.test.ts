/**
 * SDK 2.1.x checks a tenant-issued token against `${loginEndpoint}/${tid}/discovery/v2.0/keys`
 * (read in the 2.1.0 tarball). The verifier reads the configured tenant's set from that same URL,
 * and reads it only for a token whose unverified `iss` is an Entra issuer (B-420).
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest, TENANT } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("the configured tenant's key set", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("is read from the loginEndpoint, tenant and discovery/v2.0/keys, and the Bot Framework set is not", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      tenantId: TENANT,
      cloud: ks.cloud,
      __validatorModule: acceptingValidatorModule().module,
    });

    const res = await verify(
      activityRequest(
        ks.signToken({ iss: `${ks.cloud.loginEndpoint}/${TENANT}/v2.0`, tid: TENANT }),
      ),
    );

    expect(res.ok).toBe(true);
    expect(ks.requests()).toEqual([`/${TENANT}/discovery/v2.0/keys`]);
    expect([ks.tenantHits(TENANT), ks.hits()]).toEqual([1, 0]);
  });
});
