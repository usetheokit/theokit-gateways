/**
 * The peer range `^2.0.0` admits SDK 2.1.x, whose middleware exports
 * `InboundActivityTokenValidator` instead of 2.0.x's `ServiceTokenValidator` and adds a path for
 * Entra-issued (agentic identity) tokens. Every other suite runs against the 2.0.x the package
 * installs, so this one runs the real 2.1.0 validator, loaded from a dev-dependency alias, beside
 * the installed 2.0.x one, and asserts the verifier answers both the same on the Bot Framework path
 * (B-420, plan panel finding F-dom-2). The rows that differ are the Entra path, which 2.0.x refuses
 * outright and 2.1.x accepts, so the verifier's own claim checks are what refuse it there.
 */

import { createRequire } from "node:module";

import * as sdk20 from "@microsoft/teams.apps/dist/middleware/index.js";
import * as sdk21 from "@microsoft/teams.apps-2-1/dist/middleware/index.js";
import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import {
  activityRequest,
  F5_BF_SERVICE_URL_DIFFERS,
  F7_BF_OTHER_APP,
  OTHER_TENANT,
  signFixture,
  TENANT,
} from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

const require = createRequire(import.meta.url);

/** Each SDK the peer range admits, with the version installed for it and its validator's name. */
const SDKS = [
  {
    sdk: "2.0.x",
    version: (require("@microsoft/teams.apps/package.json") as { version: string }).version,
    module: sdk20 as unknown,
  },
  {
    sdk: "2.1.x",
    version: (require("@microsoft/teams.apps-2-1/package.json") as { version: string }).version,
    module: sdk21 as unknown,
  },
] as const;

const now = () => Math.floor(Date.now() / 1000);

describe("the real SDK 2.1.0 validator", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("is the 2.1.0 middleware module, which exports InboundActivityTokenValidator and not ServiceTokenValidator", () => {
    const [v20, v21] = SDKS;

    expect([v20.version, v21.version]).toEqual([expect.stringMatching(/^2\.0\./), "2.1.0"]);
    expect(typeof sdk21.InboundActivityTokenValidator).toBe("function");
    expect("ServiceTokenValidator" in sdk21).toBe(false);
  });

  async function verifierOn(module: unknown, tenantId?: string) {
    ks = await startKeyServer();
    const verify = teamsActivityVerifier({
      clientId: CLIENT_ID,
      cloud: ks.cloud,
      __validatorModule: module,
      ...(tenantId === undefined ? {} : { tenantId }),
    });
    return { ks, verify };
  }

  describe.each(SDKS)("on SDK $sdk ($version)", ({ module }) => {
    it("accepts a genuine Bot Framework token after the SDK reads the key set itself", async () => {
      const { ks, verify } = await verifierOn(module);

      const res = await verify(activityRequest(ks.signToken({})));

      expect(res).toMatchObject({ ok: true, token: { appId: CLIENT_ID, serviceUrl: SERVICE_URL } });
      // One read by the verifier, one by the SDK's own key client: the SDK was really asked.
      expect(ks.hits()).toBe(2);
    });

    it("refuses a token issued for another app id as invalid_token", async () => {
      const { ks, verify } = await verifierOn(module);

      const res = await verify(activityRequest(signFixture(ks, F7_BF_OTHER_APP.claims)));

      expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
      expect(ks.hits()).toBe(2);
    });

    it("refuses a token expired by more than 300 seconds as invalid_token", async () => {
      const { ks, verify } = await verifierOn(module);

      const res = await verify(activityRequest(ks.signToken({ exp: now() - 361 })));

      expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
      expect(ks.hits()).toBe(2);
    });

    it("refuses a token signed by a key the key set does not hold as invalid_token", async () => {
      const { ks, verify } = await verifierOn(module);

      const res = await verify(activityRequest(ks.otherKeySign({})));

      expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
      expect(ks.hits()).toBe(1);
    });

    it("refuses a token whose serviceurl claim differs from the activity as invalid_token", async () => {
      const { ks, verify } = await verifierOn(module);

      const res = await verify(activityRequest(signFixture(ks, F5_BF_SERVICE_URL_DIFFERS.claims)));

      expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    });

    it("refuses a genuine token on a Web Chat activity as channel_mismatch", async () => {
      const { ks, verify } = await verifierOn(module);
      const activity = { type: "message", serviceUrl: SERVICE_URL, channelId: "webchat" };

      const res = await verify(activityRequest(ks.signToken({}), activity));

      expect(res).toMatchObject({ ok: false, reason: "channel_mismatch" });
    });

    it("refuses a genuine token as key_set_unavailable when the SDK's own key-set read fails", async () => {
      const { ks, verify } = await verifierOn(module);
      await verify(activityRequest(ks.signToken({}, { kid: "unknown-kid" })));
      ks.failNext(503);

      const res = await verify(activityRequest(ks.signToken({})));

      expect(res).toMatchObject({ ok: false, reason: "key_set_unavailable" });
      expect(ks.hits()).toBe(2);
    });

    it("refuses a token from another tenant as tenant_mismatch before the SDK is asked", async () => {
      const { ks, verify } = await verifierOn(module, TENANT);
      const iss = `${ks.cloud.loginEndpoint}/${OTHER_TENANT}/v2.0`;

      const res = await verify(
        activityRequest(ks.signToken({ iss, tid: OTHER_TENANT, serviceurl: SERVICE_URL })),
      );

      expect(res).toMatchObject({ ok: false, reason: "tenant_mismatch" });
      expect(ks.requests()).toEqual([]);
    });
  });

  describe("on the Entra path 2.1.x adds", () => {
    function entraToken(ks: KeyServer, claims: Record<string, unknown> = {}) {
      return ks.signToken({
        iss: `${ks.cloud.loginEndpoint}/${TENANT}/v2.0`,
        tid: TENANT,
        serviceurl: SERVICE_URL,
        ...claims,
      });
    }

    it("accepts a genuine tenant-issued token for the configured tenant on 2.1.x, which 2.0.x refuses", async () => {
      const on21 = await verifierOn(sdk21, TENANT);
      const accepted = await on21.verify(activityRequest(entraToken(on21.ks)));
      const tenantReads21 = on21.ks.tenantHits(TENANT);
      await on21.ks.close();

      const on20 = await verifierOn(sdk20, TENANT);
      const refused = await on20.verify(activityRequest(entraToken(on20.ks)));

      expect(accepted).toMatchObject({ ok: true, token: { serviceUrl: SERVICE_URL } });
      // One read by the verifier, one by the 2.1.x tenant key client: the SDK was really asked.
      expect(tenantReads21).toBe(2);
      expect(refused).toMatchObject({ ok: false, reason: "invalid_token" });
    });

    it("refuses a tenant-issued token with no serviceurl claim as serviceurl_mismatch on 2.1.x", async () => {
      const { ks, verify } = await verifierOn(sdk21, TENANT);

      const res = await verify(activityRequest(entraToken(ks, { serviceurl: undefined })));

      expect(res).toMatchObject({ ok: false, reason: "serviceurl_mismatch" });
      expect(ks.tenantHits(TENANT)).toBe(2);
    });

    it("refuses a tenant-issued token whose serviceurl claim differs as serviceurl_mismatch on 2.1.x", async () => {
      const { ks, verify } = await verifierOn(sdk21, TENANT);

      const res = await verify(
        activityRequest(entraToken(ks, { serviceurl: "https://evil.example/" })),
      );

      expect(res).toMatchObject({ ok: false, reason: "serviceurl_mismatch" });
    });

    it("refuses a tenant-issued token for another app id as invalid_token on 2.1.x", async () => {
      const { ks, verify } = await verifierOn(sdk21, TENANT);

      const res = await verify(
        activityRequest(entraToken(ks, { aud: "00000000-0000-0000-0000-0000000000ff" })),
      );

      expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    });

    it("refuses an expired tenant-issued token as invalid_token on 2.1.x", async () => {
      const { ks, verify } = await verifierOn(sdk21, TENANT);

      const res = await verify(activityRequest(entraToken(ks, { exp: now() - 361 })));

      expect(res).toMatchObject({ ok: false, reason: "invalid_token" });
    });

    it("refuses a tenant-issued token on a Web Chat activity as channel_mismatch on 2.1.x", async () => {
      const { ks, verify } = await verifierOn(sdk21, TENANT);
      const activity = { type: "message", serviceUrl: SERVICE_URL, channelId: "webchat" };

      const res = await verify(activityRequest(entraToken(ks), activity));

      expect(res).toMatchObject({ ok: false, reason: "channel_mismatch" });
    });
  });
});
