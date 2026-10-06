/**
 * FR-005 under interleaving: five first requests in flight at once build one validator, because
 * the verifier caches the load promise rather than its result.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("concurrent first requests", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("builds one validator for five concurrent first requests", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule({ holdUntil: 5 });
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
    });
    const token = ks.signToken({});

    const results = await Promise.all(
      Array.from({ length: 5 }, () => verify(activityRequest(token))),
    );

    expect(calls.ctor.length).toBe(1);
    expect(calls.check).toBe(5);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
