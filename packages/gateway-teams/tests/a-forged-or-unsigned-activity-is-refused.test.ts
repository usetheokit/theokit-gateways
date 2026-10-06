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

  it("refuses a token signed by a key the key set does not hold as invalid_token", async () => {
    const { ks, verify } = await verifierWithKeys();

    const res = await verify(activityRequest(ks.otherKeySign({})));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
  });

  it("refuses a token expired by more than 300 seconds as invalid_token", async () => {
    const { ks, verify } = await verifierWithKeys();
    const now = Math.floor(Date.now() / 1000);

    const res = await verify(activityRequest(ks.signToken({ exp: now - 301 - 60 })));

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
