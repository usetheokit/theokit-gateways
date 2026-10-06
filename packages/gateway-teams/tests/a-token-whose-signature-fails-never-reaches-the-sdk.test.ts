/**
 * The verifier checks the RS256 signature against the key it read before it asks the SDK, so a
 * token naming a listed key but signed by another one is refused without any SDK work (B-420).
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("a token whose signature fails", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("is invalid_token and never reaches the SDK validator", async () => {
    ks = await startKeyServer();
    let checks = 0;
    class CountingValidator {
      async check(_header: string, body: { serviceUrl: string }) {
        checks += 1;
        return { appId: CLIENT_ID, serviceUrl: body.serviceUrl };
      }
    }
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: { InboundActivityTokenValidator: CountingValidator },
    });
    const token = ks.otherKeySign({});

    const res = await verify(activityRequest(token));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(checks).toBe(0);
  });
});
