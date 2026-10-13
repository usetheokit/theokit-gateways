/**
 * SDK 2.0.x (`ServiceTokenValidator`) has no Entra path: it looks a tenant-issued token's `kid` up
 * in the Bot Framework key set, which holds different keys, and `jwks-rsa` caches no miss. So a
 * tenant-issued token admitted to it made the SDK download the whole Bot Framework set on every
 * replay, only to refuse the token (loop-code-review LCR0103 / LCR0602, review F-dom-auth-3). The
 * verifier must refuse such a token itself on 2.0.x and read no key set for it, while 2.1.x, which
 * reads the tenant's set, still accepts it.
 */

import * as sdk20 from "@microsoft/teams.apps/dist/middleware/index.js";
import * as sdk21 from "@microsoft/teams.apps-2-1/dist/middleware/index.js";
import { afterEach, describe, expect, it } from "vitest";
import { activityRequest, TENANT } from "./helpers/claim-fixtures.js";
import { INSTALLED_SDK_LINE } from "./helpers/installed-sdk.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";
import { verifierUnderTest } from "./helpers/verifier-under-test.js";

const REPLAYS = 20;

describe("a genuine tenant-issued token with tenantId configured", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  async function verifierOn(module: unknown) {
    ks = await startKeyServer({ separateTenantKeys: true });
    const verify = verifierUnderTest({
      clientId: CLIENT_ID,
      tenantId: TENANT,
      cloud: ks.cloud,
      validatorModule: module,
    });
    const token = ks.signTenantToken({
      iss: `${ks.cloud.loginEndpoint}/${TENANT}/v2.0`,
      tid: TENANT,
      serviceurl: SERVICE_URL,
    });
    return { ks, verify, token };
  }

  // `sdk20` is whatever is installed; under the 2.1.x peer-major job there is no 2.0.x to ask.
  it.runIf(INSTALLED_SDK_LINE === "2.0.x")(
    "is refused as invalid_token on SDK 2.0.x with no key-set read across 20 replays",
    async () => {
      const { ks, verify, token } = await verifierOn(sdk20);

      const results = [];
      for (let i = 0; i < REPLAYS; i += 1) results.push(await verify(activityRequest(token)));

      expect(results.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
      expect({ botFramework: ks.hits(), tenant: ks.tenantHits(TENANT) }).toEqual({
        botFramework: 0,
        tenant: 0,
      });
    },
  );

  it("is accepted on SDK 2.1.x without reading the Bot Framework key set", async () => {
    const { ks, verify, token } = await verifierOn(sdk21);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: true, token: { serviceUrl: SERVICE_URL } });
    expect(ks.hits()).toBe(0);
  });
});
