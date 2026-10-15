/**
 * The verifier checks the signature under its own copy of the key set, and the installed SDK
 * validator then reads the key again through its own key client. When that read fails, the SDK
 * refuses with the same plain `Error` it uses for a forgery. A token whose signature the verifier
 * already verified is then refused as `key_set_unavailable`, which a route answers with a 503, not
 * as `invalid_token`. When the SDK's read succeeds and does not list the key, the refusal stays
 * `invalid_token` (B-420, review findings #68 and #73).
 */

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("a genuine token whose key the SDK reads for itself", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  /** A verifier on the real installed SDK whose own copy of the key set is already read. */
  async function verifierHoldingTheKeySet() {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    const forged = await verify(activityRequest(ks.signToken({}, { kid: randomUUID() })));
    expect([forged, ks.hits()]).toEqual([
      expect.objectContaining({ ok: false, reason: "invalid_token" }),
      1,
    ]);
    return { ks, verify };
  }

  it("is key_set_unavailable when the SDK's own read of the key set fails", async () => {
    const { ks, verify } = await verifierHoldingTheKeySet();
    ks.failNext(503);

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({
      ok: false,
      reason: "key_set_unavailable",
      message: expect.stringContaining("the Teams SDK could not read the published signing keys"),
    });
    expect(ks.hits()).toBe(2);
  });

  it("is accepted once the SDK's read succeeds again", async () => {
    const { ks, verify } = await verifierHoldingTheKeySet();
    ks.failNext(503);
    const during = await verify(activityRequest(ks.signToken({})));

    const after = await verify(activityRequest(ks.signToken({})));

    expect([during, after.ok]).toEqual([
      expect.objectContaining({ ok: false, reason: "key_set_unavailable" }),
      true,
    ]);
  });

  it("stays invalid_token when the SDK's read succeeds and no longer lists the key", async () => {
    const { ks, verify } = await verifierHoldingTheKeySet();
    const [retired] = ks.publishedKids() as [string];
    const genuine = ks.signToken({});
    ks.rotate();
    ks.retire(retired);

    const res = await verify(activityRequest(genuine));

    expect(res).toMatchObject({
      ok: false,
      reason: "invalid_token",
      message: expect.stringContaining("the Teams SDK did not accept the token"),
    });
    expect(ks.hits()).toBe(2);
  });

  it("stays invalid_token when the SDK reads the key and refuses a claim", async () => {
    const { ks, verify } = await verifierHoldingTheKeySet();

    const res = await verify(activityRequest(ks.signToken({ iss: "https://elsewhere.test" })));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
  });
});
