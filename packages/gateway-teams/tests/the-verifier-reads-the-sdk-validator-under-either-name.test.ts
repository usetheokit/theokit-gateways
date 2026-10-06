/**
 * AC-003: the SDK validator is read as `InboundActivityTokenValidator` when exported and as
 * `ServiceTokenValidator` otherwise; a module with neither refuses every request, and with no seam
 * the installed SDK's own middleware module is the one loaded.
 */

import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

function countingClass(counter: { n: number }) {
  return class {
    async check(_header: string, body: { serviceUrl: string }) {
      counter.n += 1;
      return { appId: CLIENT_ID, serviceUrl: body.serviceUrl };
    }
  };
}

describe("the SDK validator", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("uses InboundActivityTokenValidator when the SDK exports it", async () => {
    ks = await startKeyServer();
    const inbound = { n: 0 };
    const service = { n: 0 };
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: {
        InboundActivityTokenValidator: countingClass(inbound),
        ServiceTokenValidator: countingClass(service),
      },
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res.ok).toBe(true);
    expect(inbound.n).toBe(1);
    expect(service.n).toBe(0);
  });

  it("uses ServiceTokenValidator when only that name exists", async () => {
    ks = await startKeyServer();
    const service = { n: 0 };
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: { default: { ServiceTokenValidator: countingClass(service) } },
    });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res.ok).toBe(true);
    expect(service.n).toBe(1);
  });

  it("refuses every request as validator_unavailable when the SDK exports neither", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: {},
    });

    const r1 = await verify(activityRequest(ks.signToken({})));
    const r2 = await verify(activityRequest(ks.signToken({})));

    for (const res of [r1, r2]) {
      expect(res).toMatchObject({ ok: false, reason: "validator_unavailable" });
      if (!res.ok) {
        expect(res.message).toContain("InboundActivityTokenValidator");
        expect(res.message).toContain("ServiceTokenValidator");
      }
    }
  });

  it("loads a validator from the installed SDK's middleware module with no test seam", async () => {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({ clientId: CLIENT_ID, cloud: ks.cloud });

    const res = await verify(activityRequest(ks.signToken({})));

    expect(res).toMatchObject({ ok: true, token: { appId: CLIENT_ID, serviceUrl: SERVICE_URL } });
    // One read by the verifier, one by the SDK's own key client: the SDK was really asked.
    expect(ks.hits()).toBe(2);
  });
});
