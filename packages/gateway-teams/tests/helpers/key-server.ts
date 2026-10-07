/**
 * A local stand-in for the Bot Framework key set, and the signer for the tokens it vouches for.
 *
 * The SDK validator derives its key URL from the cloud's `openIdMetadataUrl` by replacing a
 * trailing `/openidconfiguration` with `/keys`, and `jwks-rsa` fetches an `http:` URL with
 * `node:http`. So a cloud whose metadata URL points at this server makes the real validator check
 * real RS256 signatures against a key nobody outside this process holds. Keys are generated per
 * server, at run time, so no key material is ever committed.
 *
 * The test cloud's `loginEndpoint` is this server too, and it answers
 * `/{tenant}/discovery/v2.0/keys` with the same published keys: the URL SDK 2.1.x and the verifier
 * derive for a configured tenant's key set. Requests to it are counted apart from `/keys`.
 */

import { createHmac, generateKeyPairSync, type KeyObject, randomUUID, sign } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/** The bot's app id every test configures. Kept here so every helper reads one test identity. */
export const CLIENT_ID = "00000000-0000-0000-0000-0000000000a1";

/** The connector service URL a genuine activity carries. */
export const SERVICE_URL = "https://smba.trafficmanager.net/amer/";

/**
 * Every field of the SDK's `CloudEnvironment`, so the control test can hand it to the SDK class
 * directly. The validators read only the first three; the rest are inert fillers.
 */
export interface TestCloud {
  readonly loginEndpoint: string;
  readonly tokenIssuer: string;
  readonly openIdMetadataUrl: string;
  readonly loginTenant: string;
  readonly botScope: string;
  readonly tokenServiceUrl: string;
  readonly graphScope: string;
}

/** Options for {@link KeyServer.signToken}. */
export interface SignOptions {
  /** Sign with this key instead of the published one. */
  readonly key?: KeyObject;
  /** The `kid` header; defaults to the published key's id. */
  readonly kid?: string;
  /** Lifetime from now; defaults to 600 seconds. */
  readonly expiresInSeconds?: number;
  /**
   * The signing algorithm; defaults to `RS256`. `HS256` signs with the published public key's PEM
   * as the HMAC secret (the key-confusion forgery); `none` writes no signature at all.
   */
  readonly alg?: "RS256" | "HS256" | "none";
}

/** A running key server. Close it in `afterEach`. */
export interface KeyServer {
  readonly port: number;
  readonly cloud: TestCloud;
  /** How many times `/keys` (the Bot Framework key set) was requested. */
  hits(): number;
  /** How many times `/{tenant}/discovery/v2.0/keys` was requested for `tenant`. */
  tenantHits(tenant: string): number;
  /** Every path requested, in order, whatever was answered. */
  requests(): readonly string[];
  /** The `kid` of every key the server publishes now, oldest first. */
  publishedKids(): readonly string[];
  /** Sign `claims` with the published key whose id is `kid`, under that `kid`. */
  signWithKid(kid: string, claims: Record<string, unknown>): string;
  /** Stop publishing the key whose id is `kid`, as Microsoft does when it retires one. */
  retire(kid: string): void;
  /** The published key-set entries (public JWKs), oldest first. */
  publishedJwks(): readonly Record<string, unknown>[];
  /**
   * A token whose payload segment is `payloadSegment` verbatim, signed with the current key under
   * its `kid`: a signature that verifies over a payload that need not decode.
   */
  signRawPayload(payloadSegment: string): string;
  /** Answer the next `/keys` request with this status instead of the key set. */
  failNext(status: number): void;
  /** Answer the next `/keys` request with this JSON document instead of the key set. */
  answerNext(document: unknown): void;
  /**
   * Leave the next `/keys` request unanswered, as a hanging endpoint does. It still counts in
   * {@link KeyServer.hits} when it arrives. The returned function answers it: with `status` when
   * given, with the key set otherwise. Closing the server drops it unanswered.
   */
  holdNext(): (status?: number) => void;
  close(): Promise<void>;
  /** Sign `claims` (merged over valid defaults; `undefined` removes a claim) with the published key. */
  signToken(claims: Record<string, unknown>, opts?: SignOptions): string;
  /** Sign with a fresh key pair the server never publishes, under the published `kid`. */
  otherKeySign(claims: Record<string, unknown>): string;
  /**
   * Publish a new key beside the current ones, as Microsoft does when it rotates, and sign with it
   * from now on. Returns the new key's `kid`.
   */
  rotate(): string;
}

/** The test cloud for a key server listening on `port`. */
export function testCloud(port: number): TestCloud {
  return {
    loginEndpoint: `http://127.0.0.1:${port}`,
    tokenIssuer: "https://api.botframework.test",
    openIdMetadataUrl: `http://127.0.0.1:${port}/openidconfiguration`,
    loginTenant: "botframework.test",
    botScope: "https://api.botframework.test/.default",
    tokenServiceUrl: "https://token.botframework.test",
    graphScope: "https://graph.test.invalid/.default",
  };
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function buildClaims(
  cloud: TestCloud,
  claims: Record<string, unknown>,
  expiresInSeconds: number,
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const merged: Record<string, unknown> = {
    iss: cloud.tokenIssuer,
    aud: CLIENT_ID,
    serviceurl: SERVICE_URL,
    nbf: now,
    iat: now,
    exp: now + expiresInSeconds,
    ...claims,
  };
  for (const name of Object.keys(merged)) {
    if (merged[name] === undefined) delete merged[name];
  }
  return merged;
}

function signWith(key: KeyObject, kid: string, payload: Record<string, unknown>): string {
  const input = `${base64url({ alg: "RS256", typ: "JWT", kid })}.${base64url(payload)}`;
  const signature = sign("sha256", Buffer.from(input), key).toString("base64url");
  return `${input}.${signature}`;
}

/** A token whose header names `alg` but whose signature no RS256 key produced. */
function forgeWith(
  alg: "HS256" | "none",
  publicKey: KeyObject,
  kid: string,
  payload: Record<string, unknown>,
): string {
  const input = `${base64url({ alg, typ: "JWT", kid })}.${base64url(payload)}`;
  if (alg === "none") return `${input}.`;
  const secret = publicKey.export({ format: "pem", type: "spki" });
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

/** A fresh RS256 key pair and its public JWK, under a random `kid`. */
function newSigningKey() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };
  return { publicKey, privateKey, kid, jwk };
}

/** Options for {@link startKeyServer}. */
export interface KeyServerOptions {
  /**
   * How many keys to publish besides the signing one. The SDK's key client caches 5 keys, so a
   * test about listed kids missing that cache publishes more than 5.
   */
  readonly extraKeys?: number;
}

const TENANT_KEYS_PATH = /^\/([^/]+)\/discovery\/v2\.0\/keys$/;

/** Start a key server on 127.0.0.1, on a free port. */
export async function startKeyServer(opts: KeyServerOptions = {}): Promise<KeyServer> {
  const extras = Array.from({ length: opts.extraKeys ?? 0 }, newSigningKey);
  let current = newSigningKey();
  const privateKeys = new Map<string, KeyObject>(
    [...extras, current].map((key) => [key.kid, key.privateKey]),
  );
  let published = [...extras.map((key) => key.jwk), current.jwk];
  let hitCount = 0;
  const tenantHitCounts = new Map<string, number>();
  const paths: string[] = [];
  let pendingFailure: number | undefined;
  let pendingDocument: { readonly document: unknown } | undefined;
  let held: { response?: ServerResponse; answer?: (res: ServerResponse) => void } | undefined;
  let unpublished: KeyObject | undefined;

  const answerKeys = (res: ServerResponse): void => {
    hitCount += 1;
    if (held !== undefined && held.response === undefined) {
      held.response = res;
      if (held.answer !== undefined) held.answer(res);
      return;
    }
    if (pendingFailure !== undefined) {
      res.writeHead(pendingFailure).end();
      pendingFailure = undefined;
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(pendingDocument ? pendingDocument.document : { keys: published }));
    pendingDocument = undefined;
  };

  const answerTenantKeys = (tenant: string, res: ServerResponse): void => {
    tenantHitCounts.set(tenant, (tenantHitCounts.get(tenant) ?? 0) + 1);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: published }));
  };

  const server = createServer((req, res) => {
    const path = req.url ?? "";
    paths.push(path);
    const tenant = TENANT_KEYS_PATH.exec(path)?.[1];
    if (tenant !== undefined) answerTenantKeys(tenant, res);
    else if (path === "/keys") answerKeys(res);
    else res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const cloud = testCloud(port);

  return {
    port,
    cloud,
    hits: () => hitCount,
    tenantHits: (tenant) => tenantHitCounts.get(tenant) ?? 0,
    requests: () => [...paths],
    publishedKids: () => published.map((jwk) => jwk.kid),
    signWithKid: (kid, claims) => {
      const key = privateKeys.get(kid);
      if (key === undefined) throw new Error(`key server: no key with kid ${kid}`);
      return signWith(key, kid, buildClaims(cloud, claims, 600));
    },
    publishedJwks: () => published.map((jwk) => ({ ...jwk })),
    signRawPayload: (payloadSegment) => {
      const input = `${base64url({ alg: "RS256", typ: "JWT", kid: current.kid })}.${payloadSegment}`;
      return `${input}.${sign("sha256", Buffer.from(input), current.privateKey).toString("base64url")}`;
    },
    retire: (kid) => {
      published = published.filter((jwk) => jwk.kid !== kid);
    },
    failNext: (status) => {
      pendingFailure = status;
    },
    answerNext: (document) => {
      pendingDocument = { document };
    },
    holdNext: () => {
      const hold: { response?: ServerResponse; answer?: (res: ServerResponse) => void } = {};
      held = hold;
      return (status) => {
        hold.answer = (res) => {
          if (held === hold) held = undefined;
          if (status === undefined) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ keys: published }));
          } else res.writeHead(status).end();
        };
        if (hold.response !== undefined) hold.answer(hold.response);
      };
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    signToken: (claims, opts = {}) => {
      const {
        alg = "RS256",
        kid: keyId = current.kid,
        key = current.privateKey,
        expiresInSeconds = 600,
      } = opts;
      const payload = buildClaims(cloud, claims, expiresInSeconds);
      return alg === "RS256"
        ? signWith(key, keyId, payload)
        : forgeWith(alg, current.publicKey, keyId, payload);
    },
    otherKeySign: (claims) => {
      unpublished ??= generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
      return signWith(unpublished, current.kid, buildClaims(cloud, claims, 600));
    },
    rotate: () => {
      current = newSigningKey();
      privateKeys.set(current.kid, current.privateKey);
      published = [...published, current.jwk];
      return current.kid;
    },
  };
}
