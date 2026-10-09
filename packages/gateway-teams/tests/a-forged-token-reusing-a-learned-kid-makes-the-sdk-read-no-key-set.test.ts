/**
 * SDK 2.1.x picks the key set it reads from a token's UNVERIFIED claims: an `iss` that starts with
 * the cloud's login endpoint sends it to `${loginEndpoint}/${tid}/discovery/v2.0/keys`, with one key
 * client per `tid`, before any signature is checked. A sender who reuses a `kid` from a genuine
 * token and varies `tid` would make the SDK read a new key set on every request. These tests send
 * exactly that, against the real 2.0.15 and 2.1.0 validators, and assert no key set is read that a
 * sender chose (review finding LCR0103 on `d2c26cd`, whose verifier admitted a learned `kid` to the
 * SDK without spending its fetch budget).
 *
 * The control proves the forged tokens are the ones that reach a tenant key set on 2.1.0 when the
 * SDK is asked directly, so a count of zero through the verifier means the verifier kept them away.
 */

import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import * as sdk20 from "@microsoft/teams.apps/dist/middleware/index.js";
import * as sdk21 from "@microsoft/teams.apps-2-1/dist/middleware/index.js";
import { afterEach, describe, expect, it } from "vitest";

import { teamsActivityVerifier } from "../src/index.js";
import { activityRequest, TENANT } from "./helpers/claim-fixtures.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL, startKeyServer } from "./helpers/key-server.js";

const require = createRequire(import.meta.url);

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

const FORGED_REQUESTS = 50;

const TENANT_KEY_SET_PATH = /^\/[^/]+\/discovery\/v2\.0\/keys$/;

/** An RS256 token under `kid` whose signature is random bytes: what a sender without a key sends. */
function forgedToken(kid: string, claims: Record<string, unknown>): string {
  const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: CLIENT_ID,
    serviceurl: SERVICE_URL,
    nbf: now,
    iat: now,
    exp: now + 600,
    ...claims,
  };
  const input = `${segment({ alg: "RS256", typ: "JWT", kid })}.${segment(payload)}`;
  return `${input}.${randomBytes(256).toString("base64url")}`;
}

/** The tenant key-set paths requested after the first `skip` requests. */
function tenantKeySetReadsAfter(ks: KeyServer, skip: number): string[] {
  return ks
    .requests()
    .slice(skip)
    .filter((path) => TENANT_KEY_SET_PATH.test(path));
}

const silentLogger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
  trace() {},
  log() {},
  child() {
    return silentLogger;
  },
};

describe("a forged token reusing a kid the verifier learned from a genuine token", () => {
  let ks: KeyServer | undefined;

  afterEach(async () => {
    await ks?.close();
    ks = undefined;
  });

  it("makes the real SDK 2.1.0 read the key set its unverified tid names when the SDK is asked directly", async () => {
    ks = await startKeyServer();
    const kid = ks.publishedKids().at(-1) as string;
    const Validator = sdk21.InboundActivityTokenValidator as unknown as new (
      ...args: unknown[]
    ) => { check(header: string, body: unknown): Promise<unknown> };
    const validator = new Validator(CLIENT_ID, undefined, undefined, silentLogger, ks.cloud);

    for (let i = 0; i < 5; i += 1) {
      const tid = `tenant-${i}`;
      const token = forgedToken(kid, { iss: `${ks.cloud.loginEndpoint}/${tid}/v2.0`, tid });
      await expect(
        validator.check(`Bearer ${token}`, { serviceUrl: SERVICE_URL }),
      ).rejects.toThrow();
    }

    expect(tenantKeySetReadsAfter(ks, 0)).toHaveLength(5);
  });

  describe.each(SDKS)("through the verifier on SDK $sdk ($version)", ({ module }) => {
    async function verifierThatAcceptedOne(tenantId: string | undefined) {
      ks = await startKeyServer();
      const verify = teamsActivityVerifier({
        clientId: CLIENT_ID,
        cloud: ks.cloud,
        __validatorModule: module,
        ...(tenantId === undefined ? {} : { tenantId }),
      });
      // A Bot Framework token for a configured tenant carries its tid, or it is tenant_unverified.
      const accepted = await verify(activityRequest(ks.signToken({ tid: tenantId })));
      const learnedKid = ks.publishedKids().at(-1) as string;
      return { ks, verify, accepted, learnedKid, before: ks.requests().length };
    }

    it.each([
      ["no tenant is configured", undefined, "tenant_unverified"],
      ["a tenant is configured", TENANT, "tenant_mismatch"],
    ])(
      "reads no tenant key set for fresh tids under the login endpoint when %s",
      async (_, tenantId, reason) => {
        const { ks, verify, accepted, learnedKid, before } =
          await verifierThatAcceptedOne(tenantId);

        const results = [];
        for (let i = 0; i < FORGED_REQUESTS; i += 1) {
          const tid = `tenant-${i}`;
          const token = forgedToken(learnedKid, {
            iss: `${ks.cloud.loginEndpoint}/${tid}/v2.0`,
            tid,
          });
          results.push(await verify(activityRequest(token)));
        }

        expect(accepted.ok).toBe(true);
        expect(results.every((r) => !r.ok && r.reason === reason)).toBe(true);
        expect(tenantKeySetReadsAfter(ks, before)).toEqual([]);
      },
    );

    it("reads no tenant key set for an issuer the SDK takes for Entra and the verifier does not", async () => {
      const { ks, verify, accepted, learnedKid, before } = await verifierThatAcceptedOne(undefined);

      const results = [];
      for (let i = 0; i < FORGED_REQUESTS; i += 1) {
        const tid = `tenant-${i}`;
        // SDK 2.1.0 tests `iss.startsWith(loginEndpoint)` with no separator; the verifier requires
        // the endpoint's path, so this token is checked against the Bot Framework key set.
        const token = forgedToken(learnedKid, {
          iss: `${ks.cloud.loginEndpoint}0/${tid}/v2.0`,
          tid,
        });
        results.push(await verify(activityRequest(token)));
      }

      expect(accepted.ok).toBe(true);
      expect(results.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
      expect(tenantKeySetReadsAfter(ks, before)).toEqual([]);
    });

    it("reads the configured tenant's key set at most once for forged tokens naming that tenant", async () => {
      const { ks, verify, accepted, learnedKid, before } = await verifierThatAcceptedOne(TENANT);

      const results = [];
      for (let i = 0; i < FORGED_REQUESTS; i += 1) {
        const token = forgedToken(learnedKid, {
          iss: `${ks.cloud.loginEndpoint}/${TENANT}/v2.0`,
          tid: TENANT,
        });
        results.push(await verify(activityRequest(token)));
      }

      expect(accepted.ok).toBe(true);
      expect(results.every((r) => !r.ok && r.reason === "invalid_token")).toBe(true);
      expect(tenantKeySetReadsAfter(ks, before)).toEqual([`/${TENANT}/discovery/v2.0/keys`]);
    });
  });
});
