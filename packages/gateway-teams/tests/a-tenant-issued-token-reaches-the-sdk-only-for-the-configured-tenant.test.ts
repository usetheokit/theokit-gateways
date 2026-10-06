/**
 * On SDK 2.1.x a token whose unverified `iss` is an Entra issuer is checked against the key set of
 * the tenant its unverified `tid` names, with one key-set client per tenant. So a sender reusing a
 * key id the verifier already learned, with a fresh `tid` per request, would cost one key-set
 * request each. A tenant-issued token for a tenant this verifier would refuse anyway never reaches
 * the SDK, and a tenant-issued token's key id is learned apart from the Bot Framework ones.
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

  async function verifierThatLearnedTheKey(tenantId: string | undefined) {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
      ...(tenantId === undefined ? {} : { tenantId }),
    });
    const learned = await verify(activityRequest(ks.signToken({ tid: tenantId })));
    return { ks, verify, calls, learned };
  }

  const entraToken = (ks: KeyServer, tid: string) =>
    ks.signToken({ iss: `${ks.cloud.loginEndpoint}/${tid}/v2.0`, tid });

  it.each([
    ["a tenant other than the configured one", TENANT, "tenant_mismatch"],
    ["any tenant when none is configured", undefined, "tenant_unverified"],
  ])("never reaches the SDK when it names %s", async (_, tenantId, reason) => {
    const { ks, verify, calls, learned } = await verifierThatLearnedTheKey(tenantId);

    const results = [];
    for (let i = 0; i < 20; i += 1) {
      results.push(await verify(activityRequest(entraToken(ks, randomUUID()))));
    }

    expect(learned.ok).toBe(true);
    expect(results.every((r) => !r.ok && r.reason === reason)).toBe(true);
    expect(calls.check).toBe(1);
  });

  it("spends the unknown-key budget even under a key id a Bot Framework token taught", async () => {
    ks = await startKeyServer();
    const loginEndpoint = ks.cloud.loginEndpoint;
    let checks = 0;
    // Accepts a Bot Framework token and refuses every tenant-issued one, as the SDK refuses a
    // forgery: the tenant-issued tokens below never teach the verifier their key.
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
    const learned = await verify(activityRequest(ks.signToken({ tid: TENANT })));

    const results = [];
    for (let i = 0; i < 20; i += 1)
      results.push(await verify(activityRequest(entraToken(ks, TENANT))));

    expect(learned.ok).toBe(true);
    expect(results.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
    expect(checks).toBe(10);
  });
});
