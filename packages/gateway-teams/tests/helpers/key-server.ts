/**
 * A local stand-in for the Bot Framework key set, and the signer for the tokens it vouches for.
 *
 * The SDK validator derives its key URL from the cloud's `openIdMetadataUrl` by replacing a
 * trailing `/openidconfiguration` with `/keys`, and `jwks-rsa` fetches an `http:` URL with
 * `node:http`. So a cloud whose metadata URL points at this server makes the real validator check
 * real RS256 signatures against a key nobody outside this process holds. Keys are generated per
 * server, at run time, so no key material is ever committed.
 */

import { generateKeyPairSync, type KeyObject, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";
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
}

/** A running key server. Close it in `afterEach`. */
export interface KeyServer {
  readonly port: number;
  readonly cloud: TestCloud;
  /** How many times `/keys` was requested. */
  hits(): number;
  /** Answer the next `/keys` request with this status instead of the key set. */
  failNext(status: number): void;
  close(): Promise<void>;
  /** Sign `claims` (merged over valid defaults; `undefined` removes a claim) with the published key. */
  signToken(claims: Record<string, unknown>, opts?: SignOptions): string;
  /** Sign with a fresh key pair the server never publishes, under the published `kid`. */
  otherKeySign(claims: Record<string, unknown>): string;
}

/** The test cloud for a key server listening on `port`. */
export function testCloud(port: number): TestCloud {
  return {
    loginEndpoint: "https://login.test.invalid",
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

/** Start a key server on 127.0.0.1, on a free port. */
export async function startKeyServer(): Promise<KeyServer> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomUUID();
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };
  let hitCount = 0;
  let pendingFailure: number | undefined;
  let unpublished: KeyObject | undefined;

  const server = createServer((req, res) => {
    if (req.url !== "/keys") {
      res.writeHead(404).end();
      return;
    }
    hitCount += 1;
    if (pendingFailure !== undefined) {
      res.writeHead(pendingFailure).end();
      pendingFailure = undefined;
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const cloud = testCloud(port);

  return {
    port,
    cloud,
    hits: () => hitCount,
    failNext: (status) => {
      pendingFailure = status;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    signToken: (claims, opts = {}) =>
      signWith(
        opts.key ?? privateKey,
        opts.kid ?? kid,
        buildClaims(cloud, claims, opts.expiresInSeconds ?? 600),
      ),
    otherKeySign: (claims) => {
      unpublished ??= generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
      return signWith(unpublished, kid, buildClaims(cloud, claims, 600));
    },
  };
}
