/**
 * AC-011: a token the SDK accepted is still refused when its tenant is not the configured one, or
 * cannot be confirmed. F1 and F2 run on the installed SDK; F3 and F4 are Entra-issued tokens the
 * 2.1.x SDK path accepts, reached here through an accepting validator.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import {
  acceptingValidatorModule,
  activityRequest,
  F1_BF_OTHER_TENANT,
  F2_BF_NO_TID,
  F3_ENTRA_OTHER_TENANT,
  F4_ENTRA_NO_TENANT_CONFIGURED,
  signFixture,
} from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("a token from another tenant", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  // F1 and F2 run on the installed SDK against the key server; F3 and F4 are Entra-issued tokens
  // the 2.1.x SDK path accepts, reached through an accepting validator and the key server's cloud.
  it.each([
    [
      "a Bot Framework token whose tid differs from the configured tenant",
      F1_BF_OTHER_TENANT,
      "sdk",
    ],
    ["a Bot Framework token with no tid when a tenant is configured", F2_BF_NO_TID, "sdk"],
    ["an Entra-issued token from another tenant", F3_ENTRA_OTHER_TENANT, "accepting"],
    [
      "an Entra-issued token when no tenant is configured",
      F4_ENTRA_NO_TENANT_CONFIGURED,
      "accepting",
    ],
  ] as const)("refuses %s by its tenant reason", async (_, fixture, path) => {
    ks = await startKeyServer();
    const tenant = fixture.tenantId === undefined ? {} : { tenantId: fixture.tenantId };
    const verify = teamsActivityVerifier(
      path === "sdk"
        ? { clientId: CLIENT_ID, cloud: ks.cloud, ...tenant }
        : {
            clientId: CLIENT_ID,
            cloud: ks.cloud,
            __validatorModule: acceptingValidatorModule().module,
            ...tenant,
          },
    );
    const token = signFixture(ks, fixture.claims);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: fixture.reason });
    expect(JSON.stringify(res).includes(token)).toBe(false);
  });

  it("throws a TypeError at construction for tenantId common", () => {
    expect(() => teamsActivityVerifier({ clientId: CLIENT_ID, tenantId: "common" })).toThrow(
      /tenantId.*common/,
    );
  });
});
