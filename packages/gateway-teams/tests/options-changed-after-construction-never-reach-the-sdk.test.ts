/**
 * The SDK validator is built from the options as they were validated at construction, not from the
 * caller's object as it stands at the first request. A caller that reuses or mutates its options
 * object after `teamsActivityVerifier` returned cannot hand the SDK an app id the verifier's own
 * `aud` check does not use, or an issuer construction would have refused (B-420, loop-code-review
 * LCR0121).
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

describe("options changed after construction", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("builds the SDK validator from the app id and cloud validated at construction", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const cloud: Mutable<typeof ks.cloud> = { ...ks.cloud };
    const options: Mutable<Parameters<typeof teamsActivityVerifier>[0]> = {
      clientId: CLIENT_ID,
      cloud,
      __validatorModule: module,
    };
    const verify = teamsActivityVerifier(options);

    options.clientId = "other-app";
    cloud.tokenIssuer = "http://evil.example";
    options.__validatorModule = {};
    const res = await verify(activityRequest(ks.signToken({})));

    expect(res.ok).toBe(true);
    expect(calls.ctor).toHaveLength(1);
    expect(calls.ctor[0]?.[0]).toBe(CLIENT_ID);
    expect(calls.ctor[0]?.[4]).toEqual(ks.cloud);
  });
});
