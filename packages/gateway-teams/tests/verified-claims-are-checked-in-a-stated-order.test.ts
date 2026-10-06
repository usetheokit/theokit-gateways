/**
 * The pure decisions behind `teamsActivityVerifier` (plan T2.1, ADR-0003): option validation,
 * bearer extraction, body parsing, claim decoding and the three claim checks in the order
 * `aud` → `serviceurl` → tenant. No key server and no SDK: these run on plain values.
 */

import { describe, expect, it } from "vitest";

import {
  assertVerifierOptions,
  checkVerifiedClaims,
  decodeVerifiedClaims,
  parseActivityBody,
  readBearerToken,
} from "../src/verified-claims.js";
import {
  ENTRA_LOGIN,
  issuerFor,
  ONE_VIOLATION_FIXTURES,
  OTHER_TENANT,
  TENANT,
} from "./helpers/claim-fixtures.js";
import { CLIENT_ID, SERVICE_URL } from "./helpers/key-server.js";

const BF_ISSUER = "https://api.botframework.com";

const validClaims = { iss: BF_ISSUER, aud: CLIENT_ID, serviceurl: SERVICE_URL };

const expectedClaims = { clientId: CLIENT_ID, loginEndpoint: ENTRA_LOGIN, serviceUrl: SERVICE_URL };

function expectedFor(tenantId: string | undefined) {
  return tenantId === undefined ? expectedClaims : { ...expectedClaims, tenantId };
}

describe("checkVerifiedClaims", () => {
  it("checks aud before serviceurl", () => {
    const r = checkVerifiedClaims(
      { ...validClaims, aud: "x", serviceurl: "https://evil.example/" },
      expectedClaims,
    );
    expect(r).toEqual({ ok: false, reason: "audience_mismatch" });
  });

  it("checks serviceurl before tid", () => {
    const r = checkVerifiedClaims(
      { ...validClaims, serviceurl: "https://evil.example/", tid: OTHER_TENANT },
      { ...expectedClaims, tenantId: TENANT },
    );
    expect(r).toEqual({ ok: false, reason: "serviceurl_mismatch" });
  });

  it("each one-violation fixture fails exactly its one check and passes once corrected", () => {
    for (const f of ONE_VIOLATION_FIXTURES) {
      const claims = issuerFor(f.claims, BF_ISSUER);
      expect(checkVerifiedClaims(claims, expectedFor(f.tenantId)), f.name).toEqual({
        ok: false,
        reason: f.reason,
      });
      const fixedClaims = { ...claims, ...f.fix.claims };
      const fixedTenant = f.fix.tenantId ?? f.tenantId;
      expect(checkVerifiedClaims(fixedClaims, expectedFor(fixedTenant)), f.name).toEqual({
        ok: true,
      });
    }
  });

  it("compares serviceurl ignoring one trailing slash and letter case", () => {
    const r = checkVerifiedClaims(
      { ...validClaims, serviceurl: "HTTPS://SMBA.trafficmanager.net/amer" },
      expectedClaims,
    );
    expect(r).toEqual({ ok: true });
  });

  it("accepts the three audiences the SDK accepts and refuses an array", () => {
    for (const aud of [CLIENT_ID, `api://botid-${CLIENT_ID}`, `api://${CLIENT_ID}`]) {
      expect(checkVerifiedClaims({ ...validClaims, aud }, expectedClaims), aud).toEqual({
        ok: true,
      });
    }
    expect(checkVerifiedClaims({ ...validClaims, aud: ["x", CLIENT_ID] }, expectedClaims)).toEqual({
      ok: false,
      reason: "audience_mismatch",
    });
    expect(
      checkVerifiedClaims({ ...validClaims, aud: `api://other-${CLIENT_ID}` }, expectedClaims),
    ).toEqual({
      ok: false,
      reason: "audience_mismatch",
    });
  });

  it("with a tenant configured, a missing or non-string tid is tenant_unverified and an upper-case equal tid is accepted", () => {
    const withTenant = { ...expectedClaims, tenantId: TENANT };
    expect(checkVerifiedClaims({ ...validClaims, tid: 42 }, withTenant)).toEqual({
      ok: false,
      reason: "tenant_unverified",
    });
    expect(checkVerifiedClaims(validClaims, withTenant)).toEqual({
      ok: false,
      reason: "tenant_unverified",
    });
    const lettered = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(
      checkVerifiedClaims(
        { ...validClaims, tid: lettered.toUpperCase() },
        { ...expectedClaims, tenantId: lettered },
      ),
    ).toEqual({ ok: true });
    expect(
      checkVerifiedClaims(
        { ...validClaims, tid: lettered },
        { ...expectedClaims, tenantId: lettered.toUpperCase() },
      ),
    ).toEqual({ ok: true });
  });

  it("with no tenant configured, an sts.windows.net or loginEndpoint issuer is tenant_unverified", () => {
    expect(
      checkVerifiedClaims({ ...validClaims, iss: "https://sts.windows.net/x/" }, expectedClaims),
    ).toEqual({
      ok: false,
      reason: "tenant_unverified",
    });
    expect(
      checkVerifiedClaims({ ...validClaims, iss: `${ENTRA_LOGIN}/x/v2.0` }, expectedClaims),
    ).toEqual({
      ok: false,
      reason: "tenant_unverified",
    });
    const sovereign = { ...expectedClaims, loginEndpoint: "https://login.sovereign.test" };
    expect(
      checkVerifiedClaims(
        { ...validClaims, iss: "https://login.sovereign.test/x/v2.0" },
        sovereign,
      ),
    ).toEqual({ ok: false, reason: "tenant_unverified" });
    expect(checkVerifiedClaims(validClaims, expectedClaims)).toEqual({ ok: true });
    expect(checkVerifiedClaims({ ...validClaims, iss: 42 }, expectedClaims)).toEqual({ ok: true });
  });
});

describe("parseActivityBody", () => {
  it("refuses a body that is not a JSON object or has no non-empty string serviceUrl", () => {
    for (const text of ["[]", "null", "{", "{}", '{"serviceUrl":""}', '{"serviceUrl":1}', '"x"']) {
      expect(parseActivityBody(text), text).toEqual({ ok: false, reason: "malformed_body" });
    }
    const activity = { type: "message", serviceUrl: SERVICE_URL };
    expect(parseActivityBody(JSON.stringify(activity))).toEqual({
      ok: true,
      activity,
      serviceUrl: SERVICE_URL,
    });
  });
});

describe("readBearerToken", () => {
  it("reads the bearer token as the SDK does", () => {
    expect(readBearerToken("Bearer a.b.c")).toBe("a.b.c");
    expect(readBearerToken("a.b.c")).toBe("a.b.c");
    expect(readBearerToken("Bearer ")).toBeUndefined();
    expect(readBearerToken("Bearer")).toBeUndefined();
    expect(readBearerToken("")).toBeUndefined();
    expect(readBearerToken(null)).toBeUndefined();
  });
});

describe("decodeVerifiedClaims", () => {
  it("decodes a payload only when it is a JSON object", () => {
    const payload = Buffer.from(JSON.stringify({ aud: CLIENT_ID })).toString("base64url");
    expect(decodeVerifiedClaims(`a.${payload}.c`)).toEqual({ aud: CLIENT_ID });
    expect(decodeVerifiedClaims("a.W10.c")).toBeUndefined();
    expect(decodeVerifiedClaims("a.MQ.c")).toBeUndefined();
    expect(decodeVerifiedClaims("a.bnVsbA.c")).toBeUndefined();
    expect(decodeVerifiedClaims("a.!!!.c")).toBeUndefined();
    expect(decodeVerifiedClaims("a.b")).toBeUndefined();
    expect(decodeVerifiedClaims(`a.${payload}.c.d`)).toBeUndefined();
  });
});

describe("assertVerifierOptions", () => {
  it("refuses options that name no tenant or no client", () => {
    const cloud = {
      loginEndpoint: ENTRA_LOGIN,
      tokenIssuer: BF_ISSUER,
      openIdMetadataUrl: "https://login.botframework.com/v1/.well-known/openidconfiguration",
    };
    expect(() => assertVerifierOptions({ clientId: CLIENT_ID, tenantId: "Common" })).toThrow(
      /tenantId.*Common/,
    );
    for (const tenantId of ["organizations", "CONSUMERS"]) {
      expect(() => assertVerifierOptions({ clientId: CLIENT_ID, tenantId }), tenantId).toThrow(
        new RegExp(`tenantId.*${tenantId}`),
      );
    }
    expect(() => assertVerifierOptions({ clientId: CLIENT_ID, tenantId: "" })).toThrow(/tenantId/);
    expect(() => assertVerifierOptions({ clientId: "" })).toThrow(/clientId/);
    expect(() => assertVerifierOptions({ clientId: 7 })).toThrow(/clientId/);
    expect(() =>
      assertVerifierOptions({ clientId: CLIENT_ID, cloud: { ...cloud, tokenIssuer: undefined } }),
    ).toThrow(/cloud\.tokenIssuer/);
    expect(() =>
      assertVerifierOptions({ clientId: CLIENT_ID, cloud: { ...cloud, loginEndpoint: "" } }),
    ).toThrow(/cloud\.loginEndpoint/);
    expect(() =>
      assertVerifierOptions({ clientId: CLIENT_ID, cloud: { ...cloud, openIdMetadataUrl: 1 } }),
    ).toThrow(/cloud\.openIdMetadataUrl/);
    expect(() => assertVerifierOptions({ clientId: CLIENT_ID, cloud: null })).toThrow(
      /cloud\.loginEndpoint/,
    );
    expect(() =>
      assertVerifierOptions({ clientId: CLIENT_ID, tenantId: TENANT, cloud }),
    ).not.toThrow();
    expect(() => assertVerifierOptions({ clientId: CLIENT_ID })).not.toThrow();
  });
});
