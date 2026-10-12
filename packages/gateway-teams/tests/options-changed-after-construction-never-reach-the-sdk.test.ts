/**
 * The SDK validator is built from the options as they were validated at construction, not from the
 * caller's object as it stands at the first request. A caller that reuses or mutates its options
 * object after `teamsActivityVerifier` returned cannot hand the SDK an app id the verifier's own
 * `aud` check does not use, or an issuer construction would have refused (B-420, loop-code-review
 * LCR0121). Each option is read once, and that read is the value both checked and used: an endpoint
 * inherited from a prototype or served by a getter reaches the SDK, and a getter answering a second
 * read differently cannot swap the value construction checked.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest, TENANT } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The three endpoints the SDK validator reads from a cloud. */
function endpointsOf(cloud: KeyServer["cloud"]): Record<string, string> {
  const { loginEndpoint, tokenIssuer, openIdMetadataUrl } = cloud;
  return { loginEndpoint, tokenIssuer, openIdMetadataUrl };
}

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

  it("hands the SDK a token issuer the cloud inherits from its prototype", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const cloud = Object.assign(Object.create({ tokenIssuer: ks.cloud.tokenIssuer }) as object, {
      loginEndpoint: ks.cloud.loginEndpoint,
      openIdMetadataUrl: ks.cloud.openIdMetadataUrl,
    }) as typeof ks.cloud;
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud, __validatorModule: module });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res.ok).toBe(true);
    expect(calls.ctor[0]?.[4]).toEqual(endpointsOf(ks.cloud));
  });

  it("reads the key set from endpoints a cloud serves through prototype getters", async () => {
    ks = await startKeyServer();
    const endpoints = ks.cloud;
    class GetterCloud {
      get loginEndpoint(): string {
        return endpoints.loginEndpoint;
      }
      get tokenIssuer(): string {
        return endpoints.tokenIssuer;
      }
      get openIdMetadataUrl(): string {
        return endpoints.openIdMetadataUrl;
      }
    }
    const { module, calls } = acceptingValidatorModule();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: new GetterCloud(),
      __validatorModule: module,
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res.ok).toBe(true);
    expect(calls.ctor[0]?.[4]).toEqual(endpointsOf(ks.cloud));
  });

  it("builds the SDK validator from the app id and tenant as construction first read them", async () => {
    ks = await startKeyServer();
    const { module, calls } = acceptingValidatorModule();
    const reads = { clientId: 0, tenantId: 0 };
    const options = {
      get clientId(): string {
        reads.clientId += 1;
        return reads.clientId === 1 ? CLIENT_ID : "other-app";
      },
      get tenantId(): string {
        reads.tenantId += 1;
        return reads.tenantId === 1 ? TENANT : "common";
      },
      cloud: ks.cloud,
      __validatorModule: module,
    };
    const verify = teamsActivityVerifier(options);

    await verify(activityRequest(ks.signToken({})));

    expect(calls.ctor[0]?.[0]).toBe(CLIENT_ID);
    expect(calls.ctor[0]?.[1]).toBe(TENANT);
  });
});
