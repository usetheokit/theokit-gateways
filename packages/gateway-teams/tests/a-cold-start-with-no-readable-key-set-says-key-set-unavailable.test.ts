/**
 * "We could not check" and "we checked and it is forged" are different answers. A verifier that has
 * never read the key set and cannot read it now refuses as `key_set_unavailable`, which a route can
 * answer as retryable, not as `invalid_token` (B-420).
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("a cold start with no readable key set", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("refuses a genuine token as key_set_unavailable", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });
    ks.failNext(503);

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({ ok: false, reason: "key_set_unavailable" });
  });
});
