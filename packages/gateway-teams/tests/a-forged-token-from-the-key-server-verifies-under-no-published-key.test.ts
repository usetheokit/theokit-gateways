/**
 * `forgeToken` writes a token whose signature bytes no key produced, so a test can send forgeries
 * without paying an RSA signature for each one (B-533). The forgery must still be one: it verifies
 * under none of the keys the server publishes, carries the same header and payload a signed token
 * would, and the verifier refuses it as a bad signature whichever listed `kid` it names.
 */

import { createPublicKey, type JsonWebKey } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { verifiesRs256 } from "../src/rs256-signature.js";
import { acceptingValidatorModule, activityRequest, TENANT } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";
import { verifierUnderTest } from "./helpers/verifier-under-test.js";

const BAD_SIGNATURE = "signature does not verify";

/**
 * The verifier's answer to a forgery naming `kid`, and how often the SDK validator was asked. A
 * stand-in validator accepts everything, so only the verifier's own signature check can refuse,
 * and the SDK middleware is never imported.
 */
async function verifyForgery(ks: KeyServer, kid: string) {
  const sdk = acceptingValidatorModule();
  const verify = verifierUnderTest({
    clientId: CLIENT_ID,
    cloud: ks.cloud,
    validatorModule: sdk.module,
  });
  const res = await verify(activityRequest(ks.forgeToken({}, { kid })));
  return { res, sdkChecks: sdk.calls.check };
}

const REFUSED_AS_BAD_SIGNATURE = {
  res: { ok: false, reason: "invalid_token", message: expect.stringContaining(BAD_SIGNATURE) },
  sdkChecks: 0,
};

describe("a forged token from the key server", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  it("verifies under none of the published keys nor the tenant key", async () => {
    const server = await startKeyServer({ extraKeys: 2, separateTenantKeys: true });
    ks = server;
    const tenantSet = await fetch(`${server.cloud.loginEndpoint}/${TENANT}/discovery/v2.0/keys`);
    const { keys: tenantJwks } = (await tenantSet.json()) as { keys: JsonWebKey[] };
    const jwks = [...server.publishedJwks(), ...tenantJwks] as JsonWebKey[];

    const verified = jwks.map((jwk) => {
      const token = server.forgeToken({}, { kid: String(jwk.kid) });
      return verifiesRs256(token, createPublicKey({ key: jwk, format: "jwk" }));
    });

    // Three Bot Framework keys and the tenant's own.
    expect(verified).toEqual([false, false, false, false]);
  });

  it("carries the same header and payload as a token signed for the same claims and kid", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    ks = await startKeyServer();
    const kid = ks.publishedKids()[0] as string;
    const claims = { tid: TENANT };

    const forged = ks.forgeToken(claims, { kid }).split(".");
    const signed = ks.signToken(claims, { kid }).split(".");

    expect(forged.slice(0, 2)).toEqual(signed.slice(0, 2));
    expect(forged[2]).not.toBe(signed[2]);
  });

  it("is refused as a bad signature when it names a listed kid", async () => {
    ks = await startKeyServer({ extraKeys: 1 });
    // Oldest first: index 0 is the extra key, not the one the server signs with.
    const listed = ks.publishedKids()[0] as string;
    expect(listed).not.toBe(ks.publishedKids().at(-1));

    expect(await verifyForgery(ks, listed)).toMatchObject(REFUSED_AS_BAD_SIGNATURE);
  });

  it("is refused as a bad signature when it names the kid the server signs with now", async () => {
    ks = await startKeyServer({ extraKeys: 1 });
    const current = ks.publishedKids().at(-1) as string;

    expect(await verifyForgery(ks, current)).toMatchObject(REFUSED_AS_BAD_SIGNATURE);
  });
});
