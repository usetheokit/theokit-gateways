/**
 * The decisions `teamsActivityVerifier` makes without the SDK: option validation, reading the
 * bearer token, parsing the body, decoding the verified token's claims, and the three claim checks
 * that run after the SDK accepted the token (ADR-0003).
 *
 * Pure on purpose: no I/O and no SDK import, so the package's mutation run covers every security
 * decision here, and the orchestration in `activity-verifier.ts` stays outside it.
 *
 * @internal
 */

import { Buffer } from "node:buffer";

/** A claim check's refusal reason. */
export type ClaimRefusal =
  | "audience_mismatch"
  | "serviceurl_mismatch"
  | "tenant_mismatch"
  | "tenant_unverified";

/** What the claim checks compare against. */
export interface ExpectedClaims {
  readonly clientId: string;
  readonly tenantId?: string | undefined;
  /** The cloud's Entra login endpoint, used to recognise a tenant-issued token. */
  readonly loginEndpoint: string;
  /** The `serviceUrl` of the activity body the token arrived with. */
  readonly serviceUrl: string;
}

/** Multi-tenant authority names: none of them names a tenant, so none can restrict one. */
const MULTI_TENANT_NAMES = ["common", "organizations", "consumers"];

/** The issuer prefix Entra v1 tokens carry, which no cloud setting changes. */
const STS_ISSUER_PREFIX = "https://sts.windows.net/";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertCloud(cloud: unknown): void {
  if (cloud === undefined) return;
  const fields = ["loginEndpoint", "tokenIssuer", "openIdMetadataUrl"] as const;
  const record = isPlainObject(cloud) ? cloud : {};
  for (const field of fields) {
    if (!isNonEmptyString(record[field])) {
      throw new TypeError(`teamsActivityVerifier: cloud.${field} must be a non-empty string`);
    }
  }
}

/**
 * Refuse, at construction, options no request could ever be verified against.
 *
 * @throws TypeError naming the field and, for a multi-tenant `tenantId`, the value.
 */
export function assertVerifierOptions(options: {
  readonly clientId: unknown;
  readonly tenantId?: unknown;
  readonly cloud?: unknown;
}): void {
  if (!isNonEmptyString(options.clientId)) {
    throw new TypeError("teamsActivityVerifier: clientId must be a non-empty string");
  }
  const { tenantId } = options;
  if (tenantId !== undefined) {
    if (!isNonEmptyString(tenantId)) {
      throw new TypeError(
        "teamsActivityVerifier: tenantId, when given, must be a non-empty string",
      );
    }
    if (MULTI_TENANT_NAMES.includes(tenantId.toLowerCase())) {
      throw new TypeError(
        `teamsActivityVerifier: tenantId "${tenantId}" names no tenant; pass the tenant's id, or omit tenantId`,
      );
    }
  }
  assertCloud(options.cloud);
}

/** The scheme prefix the SDK strips from an `Authorization` header. */
const BEARER = "Bearer ";

/**
 * The token in an `Authorization` header, read as the SDK reads it: everything after `Bearer `,
 * or the whole header when that prefix is absent. `undefined` when there is nothing to read,
 * including a bare `Bearer`, which is what Fetch leaves of `Bearer ` once it trims the value.
 */
export function readBearerToken(header: string | null): string | undefined {
  if (header === null || header === BEARER.trimEnd()) return undefined;
  const token = header.startsWith(BEARER) ? header.slice(BEARER.length) : header;
  return token.length > 0 ? token : undefined;
}

/** An activity body that carries the one field the claim checks need. */
export type ParsedBody =
  | { readonly ok: true; readonly activity: Record<string, unknown>; readonly serviceUrl: string }
  | { readonly ok: false; readonly reason: "malformed_body" };

/** Parse the request body as an activity: a JSON object with a non-empty string `serviceUrl`. */
export function parseActivityBody(text: string): ParsedBody {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "malformed_body" };
  }
  if (!isPlainObject(value) || !isNonEmptyString(value.serviceUrl)) {
    return { ok: false, reason: "malformed_body" };
  }
  return { ok: true, activity: value, serviceUrl: value.serviceUrl };
}

/**
 * The payload of a token the SDK has already verified, or `undefined` when it is not a JSON
 * object. No signature work happens here: the SDK checked this exact string first.
 */
export function decodeVerifiedClaims(rawToken: string): Record<string, unknown> | undefined {
  return decodeSegment(rawToken, 1);
}

/**
 * The `kid` of a token's JOSE header, read WITHOUT verifying anything: the sender chose it. Used
 * only to decide whether the SDK may be asked about the token, never as evidence about it.
 */
export function readTokenKeyId(rawToken: string): string | undefined {
  const kid = decodeSegment(rawToken, 0)?.kid;
  return typeof kid === "string" && kid.length > 0 ? kid : undefined;
}

/** One base64url JSON object segment of a three-segment JWT, or `undefined`. */
function decodeSegment(rawToken: string, index: 0 | 1): Record<string, unknown> | undefined {
  const segments = rawToken.split(".");
  if (segments.length !== 3) return undefined;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(segments[index] as string, "base64url").toString("utf8"),
    );
    return isPlainObject(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function normalizeServiceUrl(url: string): string {
  return url.replace(/\/$/, "").toLowerCase();
}

/** The audiences the SDK accepts. `includes` compares strictly, so an array `aud` never matches. */
function audienceMatches(aud: unknown, clientId: string): boolean {
  const accepted: readonly unknown[] = [clientId, `api://botid-${clientId}`, `api://${clientId}`];
  return accepted.includes(aud);
}

function serviceUrlMatches(claim: unknown, expected: string): boolean {
  return typeof claim === "string" && normalizeServiceUrl(claim) === normalizeServiceUrl(expected);
}

function isTenantIssued(iss: unknown, loginEndpoint: string): boolean {
  return (
    typeof iss === "string" && (iss.startsWith(loginEndpoint) || iss.startsWith(STS_ISSUER_PREFIX))
  );
}

function checkTenant(
  claims: Record<string, unknown>,
  expected: ExpectedClaims,
): ClaimRefusal | undefined {
  if (expected.tenantId === undefined) {
    return isTenantIssued(claims.iss, expected.loginEndpoint) ? "tenant_unverified" : undefined;
  }
  if (typeof claims.tid !== "string") return "tenant_unverified";
  return claims.tid.toLowerCase() === expected.tenantId.toLowerCase()
    ? undefined
    : "tenant_mismatch";
}

/**
 * Check the claims of a token the SDK accepted, in a fixed order: `aud`, then `serviceurl`, then
 * the tenant. The first refusal wins, so a token wrong in several ways is reported by its most
 * fundamental mismatch.
 */
export function checkVerifiedClaims(
  claims: Record<string, unknown>,
  expected: ExpectedClaims,
): { readonly ok: true } | { readonly ok: false; readonly reason: ClaimRefusal } {
  if (!audienceMatches(claims.aud, expected.clientId)) {
    return { ok: false, reason: "audience_mismatch" };
  }
  if (!serviceUrlMatches(claims.serviceurl, expected.serviceUrl)) {
    return { ok: false, reason: "serviceurl_mismatch" };
  }
  const tenantRefusal = checkTenant(claims, expected);
  return tenantRefusal === undefined ? { ok: true } : { ok: false, reason: tenantRefusal };
}
