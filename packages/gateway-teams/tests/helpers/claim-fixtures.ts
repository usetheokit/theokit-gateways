/**
 * The seven one-violation claim fixtures (plan T2.1). Each violates exactly one of the three claim
 * checks, so the order the checks run in never decides which reason it produces, and each carries
 * the single change (`fix`) that makes all three checks pass.
 *
 * `iss: "BF"` stands for the cloud's Bot Framework `tokenIssuer`, which depends on the key server's
 * cloud; `issuerFor` resolves it.
 */

import type { ClaimRefusal } from "../../src/verified-claims.js";
import { CLIENT_ID, type KeyServer, SERVICE_URL } from "./key-server.js";

/** The tenant the verifier is configured with. */
export const TENANT = "11111111-1111-1111-1111-111111111111";

/** A different tenant. */
export const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

/** An app id that is not this bot's. */
export const OTHER_APP = "00000000-0000-0000-0000-0000000000ff";

/**
 * The public Entra login endpoint, as the fixtures write it. {@link signFixture} rewrites it to the
 * key server's own `loginEndpoint`, so a verifier built with the key server's cloud recognises F3,
 * F4 and F6 as tenant-issued and reads the configured tenant's key set from the key server.
 */
export const ENTRA_LOGIN = "https://login.microsoftonline.com";

/** An Entra v2 issuer for `tenant`. */
export function entraIssuer(tenant: string): string {
  return `${ENTRA_LOGIN}/${tenant}/v2.0`;
}

/** Marks the Bot Framework issuer, resolved per cloud by {@link issuerFor}. */
export const BF = "BF";

/** One fixture: claims, the configured tenant, the reason, and the single fix. */
export interface ClaimFixture {
  readonly name: string;
  readonly claims: Readonly<Record<string, unknown>>;
  readonly tenantId?: string;
  readonly reason: ClaimRefusal;
  readonly fix: { readonly claims?: Readonly<Record<string, unknown>>; readonly tenantId?: string };
}

/** Resolve the `BF` issuer marker to the cloud's Bot Framework issuer. */
export function issuerFor(claims: Readonly<Record<string, unknown>>, tokenIssuer: string) {
  return claims.iss === BF ? { ...claims, iss: tokenIssuer } : { ...claims };
}

const base = { aud: CLIENT_ID, serviceurl: SERVICE_URL };

export const F1_BF_OTHER_TENANT: ClaimFixture = {
  name: "bfOtherTenant",
  claims: { ...base, iss: BF, tid: OTHER_TENANT },
  tenantId: TENANT,
  reason: "tenant_mismatch",
  fix: { claims: { tid: TENANT } },
};

export const F2_BF_NO_TID: ClaimFixture = {
  name: "bfNoTid",
  claims: { ...base, iss: BF },
  tenantId: TENANT,
  reason: "tenant_unverified",
  fix: { claims: { tid: TENANT } },
};

export const F3_ENTRA_OTHER_TENANT: ClaimFixture = {
  name: "entraOtherTenant",
  claims: { ...base, iss: entraIssuer(OTHER_TENANT), tid: OTHER_TENANT },
  tenantId: TENANT,
  reason: "tenant_mismatch",
  fix: { claims: { tid: TENANT } },
};

export const F4_ENTRA_NO_TENANT_CONFIGURED: ClaimFixture = {
  name: "entraNoTenantConfigured",
  claims: { ...base, iss: entraIssuer(TENANT), tid: TENANT },
  reason: "tenant_unverified",
  fix: { tenantId: TENANT },
};

export const F5_BF_SERVICE_URL_DIFFERS: ClaimFixture = {
  name: "bfServiceUrlDiffers",
  claims: { ...base, iss: BF, serviceurl: "https://evil.example/" },
  reason: "serviceurl_mismatch",
  fix: { claims: { serviceurl: SERVICE_URL } },
};

export const F6_ENTRA_NO_SERVICE_URL: ClaimFixture = {
  name: "entraNoServiceUrl",
  claims: { aud: CLIENT_ID, iss: entraIssuer(TENANT), tid: TENANT },
  tenantId: TENANT,
  reason: "serviceurl_mismatch",
  fix: { claims: { serviceurl: SERVICE_URL } },
};

export const F7_BF_OTHER_APP: ClaimFixture = {
  name: "bfOtherApp",
  claims: { ...base, iss: BF, aud: OTHER_APP },
  reason: "audience_mismatch",
  fix: { claims: { aud: CLIENT_ID } },
};

/** All seven, in table order. */
export const ONE_VIOLATION_FIXTURES: readonly ClaimFixture[] = [
  F1_BF_OTHER_TENANT,
  F2_BF_NO_TID,
  F3_ENTRA_OTHER_TENANT,
  F4_ENTRA_NO_TENANT_CONFIGURED,
  F5_BF_SERVICE_URL_DIFFERS,
  F6_ENTRA_NO_SERVICE_URL,
  F7_BF_OTHER_APP,
];

/**
 * Sign `claims` with the key server; `BF` resolves to its issuer, an {@link ENTRA_LOGIN} issuer moves
 * to the key server's `loginEndpoint`, and absent default claims stay absent.
 */
export function signFixture(ks: KeyServer, claims: Readonly<Record<string, unknown>>): string {
  const resolved = issuerFor(claims, ks.cloud.tokenIssuer);
  if (typeof resolved.iss === "string" && resolved.iss.startsWith(ENTRA_LOGIN)) {
    resolved.iss = `${ks.cloud.loginEndpoint}${resolved.iss.slice(ENTRA_LOGIN.length)}`;
  }
  return ks.signToken({ serviceurl: undefined, ...resolved });
}

/** A POST the connector would send: a bearer token (when given) and a JSON body. */
export function activityRequest(
  token: string | undefined,
  body: unknown = { type: "message", serviceUrl: SERVICE_URL, channelId: "msteams" },
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  return new Request("https://bot.test/api/messages", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** What an accepting validator recorded. */
export interface ValidatorCalls {
  readonly ctor: unknown[][];
  check: number;
}

/**
 * A stand-in for the SDK middleware module whose validator accepts every token, so a test reaches
 * the claim checks for tokens the real SDK would refuse first (the 2.1.x Entra path). With
 * `holdUntil`, every `check` waits until that many are in flight; a miscount fails at vitest's
 * test timeout rather than hanging the run.
 */
export function acceptingValidatorModule(
  opts: {
    readonly name?: "InboundActivityTokenValidator" | "ServiceTokenValidator";
    readonly holdUntil?: number;
  } = {},
): { readonly module: Record<string, unknown>; readonly calls: ValidatorCalls } {
  const calls: ValidatorCalls = { ctor: [], check: 0 };
  let release: () => void = () => {};
  const allInFlight = new Promise<void>((resolve) => {
    release = resolve;
  });
  class AcceptingValidator {
    constructor(...args: unknown[]) {
      calls.ctor.push(args);
    }
    async check(_header: string, body: { serviceUrl: string }) {
      calls.check += 1;
      if (opts.holdUntil !== undefined) {
        if (calls.check >= opts.holdUntil) release();
        await allInFlight;
      }
      return { appId: CLIENT_ID, serviceUrl: body.serviceUrl };
    }
  }
  return { module: { [opts.name ?? "InboundActivityTokenValidator"]: AcceptingValidator }, calls };
}
