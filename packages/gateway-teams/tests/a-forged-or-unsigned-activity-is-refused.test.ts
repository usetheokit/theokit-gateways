/**
 * AC-001: an unsigned, forged, expired or malformed request is refused with a typed reason, the
 * refusal never carries the token, and a request with no credential costs no key-set request.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("a forged or unsigned activity", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  async function verifierWithKeys() {
    ks = await startKeyServer();
    return { ks, verify: teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud }) };
  }

  it("refuses a request with no Authorization header as missing_authorization and makes 0 key-set requests", async () => {
    const { ks, verify } = await verifierWithKeys();

    const res = await verify(activityRequest(undefined));

    expect(res).toMatchObject({ ok: false, reason: "missing_authorization" });
    expect(ks.hits()).toBe(0);
  });

  const now = () => Math.floor(Date.now() / 1000);

  // One row per check the installed SDK makes before the verifier sees a claim. The signature,
  // algorithm and issuer rules are the SDK's alone (the verifier checks only aud, serviceurl and
  // tenant), so each row fails if an SDK upgrade stops making that check.
  it.each([
    ["signed by a key the key set does not hold", (ks: KeyServer) => ks.otherKeySign({})],
    ["expired by more than 300 seconds", (ks: KeyServer) => ks.signToken({ exp: now() - 361 })],
    ["unsigned, with alg none", (ks: KeyServer) => ks.signToken({}, { alg: "none" })],
    [
      "HMAC-signed with the published public key as secret (alg HS256)",
      (ks: KeyServer) => ks.signToken({}, { alg: "HS256" }),
    ],
    [
      "naming a kid the key set does not hold",
      (ks: KeyServer) => ks.signToken({}, { kid: "unknown-kid" }),
    ],
    [
      "issued by another issuer",
      (ks: KeyServer) => ks.signToken({ iss: "https://issuer.other.example" }),
    ],
    ["carrying no issuer", (ks: KeyServer) => ks.signToken({ iss: undefined })],
    ["not valid for another hour (nbf)", (ks: KeyServer) => ks.signToken({ nbf: now() + 3600 })],
  ])("refuses a token %s as invalid_token through the installed SDK", async (_, token) => {
    const { ks, verify } = await verifierWithKeys();

    const res = await verify(activityRequest(token(ks)));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
  });

  it("refuses a body that is not a JSON object as malformed_body", async () => {
    const { ks, verify } = await verifierWithKeys();

    const res = await verify(activityRequest(ks.signToken({}), "not json"));

    expect(res).toMatchObject({ ok: false, reason: "malformed_body" });
    expect(ks.hits()).toBe(0);
  });

  it("never puts the token in the refusal", async () => {
    const { ks, verify } = await verifierWithKeys();
    const now = Math.floor(Date.now() / 1000);
    const refused = [
      ks.otherKeySign({}),
      ks.signToken({ exp: now - 400 }),
      ks.signToken({ aud: "00000000-0000-0000-0000-0000000000ff" }),
    ];

    for (const token of refused) {
      const res = await verify(activityRequest(token));
      expect(res.ok).toBe(false);
      expect(JSON.stringify(res).includes(token)).toBe(false);
    }
  });
});
