/**
 * Control for the test key server: before any verifier test trusts a token this fixture signs, the
 * real SDK validator has to accept it, and has to refuse one signed by a key the server does not
 * publish. If either fails, every verifier test downstream would be failing for the fixture's
 * reason rather than the verifier's.
 *
 * The validator is the one the installed SDK exports, loaded as the verifier loads it: 2.0.x
 * exports `ServiceTokenValidator` and 2.1.x `InboundActivityTokenValidator`, and the CI matrix
 * runs both.
 */

import { afterEach, describe, expect, it } from "vitest";

import { loadValidator, type TokenValidatorLike } from "../src/sdk-validator.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";
// Loaded at collection, outside any test's budget: the first verified request used to pay the SDK middleware's first import inside its own 5 s (B-545).
import "@microsoft/teams.apps/dist/middleware/index.js";

/** The installed SDK's validator for the test key server's cloud. */
async function sdkValidator(ks: KeyServer): Promise<TokenValidatorLike> {
  const loaded = await loadValidator({ clientId: CLIENT_ID, cloud: ks.cloud });
  if ("unavailable" in loaded)
    throw new Error(`the SDK validator did not load: ${loaded.unavailable}`);
  return loaded.validator;
}

describe("the test key server", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("the SDK accepts a token the test key server signed", async () => {
    ks = await startKeyServer();
    const validator = await sdkValidator(ks);
    const token = ks.signToken({});

    const res = (await validator.check(`Bearer ${token}`, { serviceUrl: SERVICE_URL })) as {
      serviceUrl?: unknown;
      appId?: unknown;
    };

    expect(res.serviceUrl).toBe(SERVICE_URL);
    expect(res.appId).toBe(CLIENT_ID);
    expect(ks.hits()).toBe(1);
  });

  it("the SDK rejects a token signed by a key the server does not publish", async () => {
    ks = await startKeyServer();
    const validator = await sdkValidator(ks);
    const forged = ks.otherKeySign({});

    await expect(validator.check(`Bearer ${forged}`, { serviceUrl: SERVICE_URL })).rejects.toThrow(
      "Invalid token",
    );
    expect(ks.hits()).toBe(1);
  });
});
