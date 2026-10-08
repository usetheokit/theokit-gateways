/**
 * The two issuers are checked against two key sets, each read on its own schedule, and nothing is
 * shared between them that forged traffic could spend. So forged Bot Framework tokens never keep a
 * genuine tenant-issued token out (B-420).
 */

import { generateKeyPairSync, randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest, TENANT } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

describe("a tenant-issued token after forged Bot Framework tokens", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await ks?.close();
    ks = undefined;
  });

  it("is accepted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      tenantId: TENANT,
      cloud: ks.cloud,
      __validatorModule: acceptingValidatorModule().module,
    });
    const stray = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const refused = [];
    for (let i = 0; i < 20; i += 1) {
      refused.push(
        await verify(
          activityRequest(ks.signToken({ tid: TENANT }, { kid: randomUUID(), key: stray })),
        ),
      );
    }

    const res = await verify(
      activityRequest(
        ks.signToken({ iss: `${ks.cloud.loginEndpoint}/${TENANT}/v2.0`, tid: TENANT }),
      ),
    );

    expect(res).toEqual({
      ok: true,
      activity: { type: "message", serviceUrl: SERVICE_URL, channelId: "msteams" },
      token: { appId: CLIENT_ID, serviceUrl: SERVICE_URL },
    });
    expect(refused).toEqual(
      Array.from({ length: 20 }, () => ({
        ok: false,
        reason: "invalid_token",
        message: expect.stringContaining("the published key set, as last read, does not list"),
      })),
    );
    // The forged tokens spent the Bot Framework set's read; the tenant's set was read for itself.
    expect([ks.hits(), ks.tenantHits(TENANT)]).toEqual([1, 1]);
  });
});
