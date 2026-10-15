/**
 * The SDK validator is the only judge of a token's issuer on the Bot Framework path (ADR-0005), so
 * nothing a caller puts in the options may stand in for it. A `__validatorModule` field, own or
 * inherited from a prototype, used to replace the SDK's middleware module, and a probe used one to
 * get a token with a foreign issuer accepted (B-420, loop-code-review LCR0121). The options now
 * carry no such seam: the verifier loads the installed SDK whatever the object holds.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

const FOREIGN_ISSUER = "https://not-bot-framework.example";

type VerifierOptions = Parameters<typeof teamsActivityVerifier>[0];

describe("a validator module carried by the options", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("is ignored as an own property, so a token with a foreign issuer is refused", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const options = { clientId: CLIENT_ID, cloud: ks.cloud, __validatorModule: module };
    const verify = teamsActivityVerifier(options as VerifierOptions);

    const res = await verify(activityRequest(ks.signToken({ iss: FOREIGN_ISSUER })));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(calls.ctor).toHaveLength(0);
  });

  it("is ignored when inherited from a prototype, so a token with a foreign issuer is refused", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const options = Object.assign(Object.create({ __validatorModule: module }) as object, {
      clientId: CLIENT_ID,
      cloud: ks.cloud,
    });
    const verify = teamsActivityVerifier(options as VerifierOptions);

    const res = await verify(activityRequest(ks.signToken({ iss: FOREIGN_ISSUER })));

    expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    expect(calls.ctor).toHaveLength(0);
  });
});
