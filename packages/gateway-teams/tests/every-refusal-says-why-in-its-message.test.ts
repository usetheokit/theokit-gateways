/**
 * A refusal carries one typed `reason` and a `message` an operator reads in a log. The reason
 * routes the answer (401, 403, 503); the message is the only place that says what was wrong. Each
 * refusal the verifier can produce is reached here through a request, and its message is checked
 * for the words that tell it apart, so a blank or swapped message fails a test (B-420).
 */

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import {
  acceptingValidatorModule,
  activityRequest,
  type ClaimFixture,
  F1_BF_OTHER_TENANT,
  F2_BF_NO_TID,
  F3_ENTRA_OTHER_TENANT,
  F4_ENTRA_NO_TENANT_CONFIGURED,
  F5_BF_SERVICE_URL_DIFFERS,
  F6_ENTRA_NO_SERVICE_URL,
  F7_BF_OTHER_APP,
  signFixture,
} from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

const TENANT_MISMATCH = "the token's tid claim names a tenant other than the configured one";
const TENANT_UNVERIFIED = "the token's tenant cannot be confirmed";

describe("the message of a refusal", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  async function server() {
    ks = await startKeyServer();
    return ks;
  }

  it("says no Authorization header was sent", async () => {
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: (await server()).cloud });

    expect(await verify(activityRequest(undefined))).toEqual({
      ok: false,
      reason: "missing_authorization",
      message: expect.stringContaining("no Authorization header"),
    });
  });

  it("says the body is not a readable activity", async () => {
    const ks = await server();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });

    expect(await verify(activityRequest(ks.signToken({}), "not json"))).toEqual({
      ok: false,
      reason: "malformed_body",
      message: expect.stringContaining("is not a readable JSON activity"),
    });
  });

  it("says the token names no signing key", async () => {
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: (await server()).cloud });

    expect(await verify(activityRequest("not-a-jwt"))).toEqual({
      ok: false,
      reason: "invalid_token",
      message: expect.stringContaining("whose header names its signing key"),
    });
  });

  it("says the token does not name RS256", async () => {
    const ks = await server();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });

    expect(
      await verify(activityRequest(ks.signToken({}, { alg: "HS256", kid: randomUUID() }))),
    ).toEqual({
      ok: false,
      reason: "invalid_token",
      message: expect.stringContaining("does not name RS256"),
    });
  });

  it("says the SDK did not accept the token when it refuses one", async () => {
    const ks = await server();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: {
        InboundActivityTokenValidator: class {
          async check(): Promise<never> {
            throw new Error("Invalid token");
          }
        },
      },
    });

    expect(await verify(activityRequest(ks.signToken({})))).toEqual({
      ok: false,
      reason: "invalid_token",
      message: expect.stringContaining("the Teams SDK did not accept the token"),
    });
  });

  it("says the activity did not come from Teams", async () => {
    const ks = await server();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: acceptingValidatorModule().module,
    });
    const body = { type: "message", serviceUrl: SERVICE_URL, channelId: "webchat" };

    expect(await verify(activityRequest(ks.signToken({}), body))).toEqual({
      ok: false,
      reason: "channel_mismatch",
      message: expect.stringContaining("channelId is absent or is not msteams"),
    });
  });

  it.each<[string, ClaimFixture, string]>([
    ["another app's audience", F7_BF_OTHER_APP, "the token's aud claim is not this bot's app id"],
    [
      "a serviceurl that differs",
      F5_BF_SERVICE_URL_DIFFERS,
      "serviceurl claim is absent or differs",
    ],
    ["an Entra token with no serviceurl", F6_ENTRA_NO_SERVICE_URL, "serviceurl claim is absent"],
    ["a Bot Framework token from another tenant", F1_BF_OTHER_TENANT, TENANT_MISMATCH],
    ["an Entra token from another tenant", F3_ENTRA_OTHER_TENANT, TENANT_MISMATCH],
    ["a Bot Framework token with no tid", F2_BF_NO_TID, TENANT_UNVERIFIED],
    ["an Entra token with no tenant configured", F4_ENTRA_NO_TENANT_CONFIGURED, TENANT_UNVERIFIED],
  ])("names the claim that failed for %s", async (_, fixture, phrase) => {
    const ks = await server();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      ...(fixture.tenantId === undefined ? {} : { tenantId: fixture.tenantId }),
      __validatorModule: acceptingValidatorModule().module,
    });

    expect(await verify(activityRequest(signFixture(ks, fixture.claims)))).toEqual({
      ok: false,
      reason: fixture.reason,
      message: expect.stringContaining(phrase),
    });
  });
});
