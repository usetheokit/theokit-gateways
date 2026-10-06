/**
 * On SDK 2.1.x a token whose unverified `iss` is an Entra issuer is checked against the key set of
 * the tenant its unverified `tid` names, with one key-set client per tenant. So a sender choosing a
 * fresh `tid` per request would cost one key-set request each. A tenant-issued token for a tenant
 * this verifier would refuse anyway never reaches the SDK, and one for the configured tenant is
 * checked against that tenant's key set, with nothing shared with the Bot Framework path.
 */

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest, TENANT } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("a tenant-issued token", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  async function verifierThatAcceptedOne(tenantId: string | undefined) {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
      ...(tenantId === undefined ? {} : { tenantId }),
    });
    const accepted = await verify(activityRequest(ks.signToken({ tid: tenantId })));
    return { ks, verify, calls, accepted };
  }

  const entraToken = (ks: KeyServer, tid: string) =>
    ks.signToken({ iss: `${ks.cloud.loginEndpoint}/${tid}/v2.0`, tid });

  it.each([
    ["a tenant other than the configured one", TENANT, "tenant_mismatch"],
    ["any tenant when none is configured", undefined, "tenant_unverified"],
  ])("never reaches the SDK when it names %s", async (_, tenantId, reason) => {
    const { ks, verify, calls, accepted } = await verifierThatAcceptedOne(tenantId);

    const results = [];
    for (let i = 0; i < 20; i += 1) {
      results.push(await verify(activityRequest(entraToken(ks, randomUUID()))));
    }

    expect(accepted.ok).toBe(true);
    expect(results.every((r) => !r.ok && r.reason === reason)).toBe(true);
    expect(calls.check).toBe(1);
  });

  it("reaches the SDK for every configured-tenant token whose signature verifies, with no budget to spend", async () => {
    ks = await startKeyServer();
    const loginEndpoint = ks.cloud.loginEndpoint;
    let checks = 0;
    // Accepts a Bot Framework token and refuses every tenant-issued one, as the SDK refuses a
    // token it does not accept.
    class BotFrameworkOnlyValidator {
      async check(header: string, body: { serviceUrl: string }) {
        checks += 1;
        const payload = header.split(".")[1] ?? "";
        const { iss } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (String(iss).startsWith(loginEndpoint)) throw new Error("Invalid token");
        return { appId: CLIENT_ID, serviceUrl: body.serviceUrl };
      }
    }
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      tenantId: TENANT,
      cloud: ks.cloud,
      __validatorModule: { InboundActivityTokenValidator: BotFrameworkOnlyValidator },
    });
    const accepted = await verify(activityRequest(ks.signToken({ tid: TENANT })));

    const results = [];
    for (let i = 0; i < 20; i += 1)
      results.push(await verify(activityRequest(entraToken(ks, TENANT))));

    expect(accepted.ok).toBe(true);
    expect(results.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
    expect(checks).toBe(21);
  });
});
