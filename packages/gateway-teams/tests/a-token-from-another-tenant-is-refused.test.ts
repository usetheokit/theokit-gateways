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
  TENANT,
} from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("a token from another tenant", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("refuses a Bot Framework token whose tid differs from the configured tenant as tenant_mismatch", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      tenantId: TENANT,
      cloud: ks.cloud,
    });
    const token = signFixture(ks, F1_BF_OTHER_TENANT.claims);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: "tenant_mismatch" });
    expect(JSON.stringify(res).includes(token)).toBe(false);
  });

  it("refuses a Bot Framework token with no tid when a tenant is configured as tenant_unverified", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      tenantId: TENANT,
      cloud: ks.cloud,
    });
    const token = signFixture(ks, F2_BF_NO_TID.claims);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: "tenant_unverified" });
    expect(JSON.stringify(res).includes(token)).toBe(false);
  });

  it("refuses an Entra-issued token from another tenant as tenant_mismatch", async () => {
    ks = await startKeyServer();
    const { module } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      tenantId: TENANT,
      __validatorModule: module,
    });
    const token = signFixture(ks, F3_ENTRA_OTHER_TENANT.claims);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: "tenant_mismatch" });
    expect(JSON.stringify(res).includes(token)).toBe(false);
  });

  it("refuses an Entra-issued token when no tenant is configured as tenant_unverified", async () => {
    ks = await startKeyServer();
    const { module } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, __validatorModule: module });
    const token = signFixture(ks, F4_ENTRA_NO_TENANT_CONFIGURED.claims);

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: "tenant_unverified" });
    expect(JSON.stringify(res).includes(token)).toBe(false);
  });

  it("throws a TypeError at construction for tenantId common", () => {
    expect(() => teamsActivityVerifier({ clientId: CLIENT_ID, tenantId: "common" })).toThrow(
      /tenantId.*common/,
    );
  });
});
