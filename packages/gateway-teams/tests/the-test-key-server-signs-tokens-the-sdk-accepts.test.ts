/**
 * Control for the test key server: before any verifier test trusts a token this fixture signs, the
 * real SDK validator has to accept it, and has to refuse one signed by a key the server does not
 * publish. If either fails, every verifier test downstream would be failing for the fixture's
 * reason rather than the verifier's.
 */

import { ServiceTokenValidator } from "@microsoft/teams.apps/dist/middleware/index.js";
import { afterEach, describe, expect, it } from "vitest";

import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

describe("the test key server", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("the SDK accepts a token the test key server signed", async () => {
    ks = await startKeyServer();
    const validator = new ServiceTokenValidator(
      CLIENT_ID,
      undefined,
      undefined,
      undefined,
      ks.cloud,
    );
    const token = ks.signToken({});

    const res = await validator.check(`Bearer ${token}`, { serviceUrl: SERVICE_URL });

    expect(res.serviceUrl).toBe(SERVICE_URL);
    expect(res.appId).toBe(CLIENT_ID);
    expect(ks.hits()).toBe(1);
  });

  it("the SDK rejects a token signed by a key the server does not publish", async () => {
    ks = await startKeyServer();
    const validator = new ServiceTokenValidator(
      CLIENT_ID,
      undefined,
      undefined,
      undefined,
      ks.cloud,
    );
    const forged = ks.otherKeySign({});

    await expect(validator.check(`Bearer ${forged}`, { serviceUrl: SERVICE_URL })).rejects.toThrow(
      "Invalid token",
    );
    expect(ks.hits()).toBe(1);
  });
});
