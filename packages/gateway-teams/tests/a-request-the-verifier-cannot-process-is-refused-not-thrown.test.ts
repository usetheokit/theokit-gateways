/**
 * EC-1 to EC-3: the paths where something the verifier depends on misbehaves still end in a typed
 * refusal, never a rejected promise.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("a request the verifier cannot process", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("refuses a request whose body was already read as malformed_body instead of throwing", async () => {
    ks = await startKeyServer();
    const { module } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, __validatorModule: module });
    const req = activityRequest(ks.signToken({}));
    await req.text();

    expect(await verify(req)).toMatchObject({ ok: false, reason: "malformed_body" });
  });

  it("refuses every request as validator_unavailable when the validator constructor throws", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      __validatorModule: {
        InboundActivityTokenValidator: class {
          constructor() {
            throw new Error("bad cloud");
          }
        },
      },
    });

    const r1 = await verify(activityRequest(ks.signToken({})));
    const r2 = await verify(activityRequest(ks.signToken({})));

    expect(r1).toMatchObject({ ok: false, reason: "validator_unavailable" });
    expect(r2).toMatchObject({ ok: false, reason: "validator_unavailable" });
  });

  it("refuses as invalid_token when the validator resolves something that is not a token", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      __validatorModule: {
        InboundActivityTokenValidator: class {
          async check() {
            return undefined;
          }
        },
      },
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
  });
});
