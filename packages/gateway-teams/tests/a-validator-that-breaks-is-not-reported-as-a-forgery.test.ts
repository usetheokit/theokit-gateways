/**
 * The SDK validator refuses a token by throwing a plain `Error` ("Invalid token", "No token
 * provided", "Entra inbound token is missing tid" in 2.0.x and 2.1.x). Any other throw from
 * `check()` is the validator breaking, not a verdict on the token: it stays a refusal, reported as
 * `validator_unavailable` naming the error's class, so an SDK fault does not read as an attack.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

const PRIVATE_TEXT = "private-detail-91c2";

function throwingValidatorModule(thrown: unknown) {
  return {
    InboundActivityTokenValidator: class {
      async check(): Promise<never> {
        throw thrown;
      }
    },
  };
}

describe("a validator that breaks while checking", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it.each([
    ["a TypeError", new TypeError(PRIVATE_TEXT), "TypeError"],
    ["a thrown string", PRIVATE_TEXT, "a thrown string"],
  ])(
    "refuses %s from check() as validator_unavailable naming its kind",
    async (_, thrown, kind) => {
      ks = await startKeyServer();
      const verify = teamsActivityVerifier({
        clientId: CLIENT_ID,
        __validatorModule: throwingValidatorModule(thrown),
      });

      const res = await verify(activityRequest(ks.signToken({})));

      expect(res).toMatchObject({ ok: false, reason: "validator_unavailable" });
      expect(res.ok ? "" : res.message).toContain(kind);
      expect(res.ok ? "" : res.message).not.toContain(PRIVATE_TEXT);
    },
  );

  it("refuses the SDK's own plain Error from check() as invalid_token", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      __validatorModule: throwingValidatorModule(new Error("Invalid token")),
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
  });
});
