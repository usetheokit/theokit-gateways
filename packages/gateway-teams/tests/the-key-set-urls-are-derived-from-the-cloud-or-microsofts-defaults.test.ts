/**
 * The verifier reads the key sets the Teams SDK reads: with no `cloud`, Microsoft's public Bot
 * Framework set and, with a `tenantId`, that tenant's Entra set; with a `cloud`, the URL derived
 * from its metadata URL by replacing the trailing `/openidconfiguration` with `/keys`. A refusal
 * names the set and the URL it read, so an operator can see which one failed (B-420).
 *
 * `fetch` is stubbed for the default endpoints: nothing here reaches Microsoft.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { acceptingValidatorModule, activityRequest, TENANT } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, startKeyServer } from "./helpers/key-server.js";

describe("the key-set URL the verifier reads", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await ks?.close();
    ks = undefined;
  });

  function unreachableMicrosoft() {
    return vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 503 }));
  }

  it("is Microsoft's public Bot Framework key set when no cloud is given", async () => {
    ks = await startKeyServer();
    const fetchSpy = unreachableMicrosoft();
    const url = "https://login.botframework.com/v1/.well-known/keys";
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      __validatorModule: acceptingValidatorModule().module,
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(fetchSpy.mock.calls.map(([called]) => String(called))).toEqual([url]);
    expect(res).toEqual({
      ok: false,
      reason: "key_set_unavailable",
      message: expect.stringContaining(`(Bot Framework key set at ${url}: HTTP 503)`),
    });
  });

  it("is the tenant's Entra key set on Microsoft's login endpoint for a tenant-issued token", async () => {
    ks = await startKeyServer();
    const fetchSpy = unreachableMicrosoft();
    const url = `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`;
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      tenantId: TENANT,
      __validatorModule: acceptingValidatorModule().module,
    });
    const token = ks.signToken({
      iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      tid: TENANT,
    });

    const res = await verify(activityRequest(token));

    expect(fetchSpy.mock.calls.map(([called]) => String(called))).toEqual([url]);
    expect(res).toEqual({
      ok: false,
      reason: "key_set_unavailable",
      message: expect.stringContaining(`(tenant ${TENANT} key set at ${url}: HTTP 503)`),
    });
  });

  it("replaces only the trailing /openidconfiguration of the cloud's metadata URL", async () => {
    ks = await startKeyServer();
    const base = ks.cloud.loginEndpoint;
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: {
        ...ks.cloud,
        openIdMetadataUrl: `${base}/openidconfiguration/v1/openidconfiguration`,
      },
      __validatorModule: acceptingValidatorModule().module,
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(ks.requests()).toEqual(["/openidconfiguration/v1/keys"]);
    expect(res).toEqual({
      ok: false,
      reason: "key_set_unavailable",
      message: expect.stringContaining(`${base}/openidconfiguration/v1/keys: HTTP 404`),
    });
  });
});
