/**
 * Local stand-ins for Google: an RSA key pair made in the test, ID tokens signed with it, and a
 * scripted `fetch` that serves its key set, the token endpoint and the Chat API. Nothing leaves
 * the process.
 */

import { Buffer } from "node:buffer";
import { generateKeyPairSync, type JsonWebKey, sign } from "node:crypto";

import type { FetchLike } from "../src/index.js";

export const AUDIENCE = "https://bot.example.com/google-chat";
export const SERVICE_ACCOUNT = "theo-bot@theo-dev.iam.gserviceaccount.com";
export const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const NOW_MS = 1_800_000_000_000;

// Made once per file, outside any fake-timer test: generating an RSA key takes tens of ms.
const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const app = generateKeyPairSync("rsa", { modulusLength: 2048 });

/** The service account's key, as the PEM a JSON key file carries. */
export const APP_PRIVATE_KEY_PEM = app.privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;

export const GOOGLE_KID = "google-key-1";

/** Google's published key set, holding only `GOOGLE_KID`. */
export function publishedKeySet(): { keys: JsonWebKey[] } {
  const jwk = google.publicKey.export({ format: "jwk" }) as JsonWebKey;
  return { keys: [{ ...jwk, kid: GOOGLE_KID, alg: "RS256", use: "sig" }] };
}

/** The claims Chat's ID token carries, valid for `AUDIENCE` at `NOW_MS`. */
export function chatClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: AUDIENCE,
    email: "chat@system.gserviceaccount.com",
    email_verified: true,
    iat: NOW_MS / 1000 - 10,
    exp: NOW_MS / 1000 + 3600,
    ...overrides,
  };
}

/** An RS256 token over `claims`, signed by Google's key unless told otherwise. */
export function idToken(
  claims: Record<string, unknown> = chatClaims(),
  opts: { kid?: string; signedByStranger?: boolean } = {},
): string {
  const header = { alg: "RS256", typ: "JWT", kid: opts.kid ?? GOOGLE_KID };
  const signedPart = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  const key = opts.signedByStranger ? stranger.privateKey : google.privateKey;
  return `${signedPart}.${b64(sign("RSA-SHA256", Buffer.from(signedPart), key))}`;
}

function b64(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** A Chat `MESSAGE` interaction event. */
export function messageEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "MESSAGE",
    eventTime: "2026-10-21T12:00:00Z",
    user: { name: "users/111", displayName: "Ana", type: "HUMAN" },
    space: { name: "spaces/AAA", type: "ROOM", spaceType: "SPACE" },
    message: {
      name: "spaces/AAA/messages/M1",
      text: "@Theo hello there",
      argumentText: " hello there",
      thread: { name: "spaces/AAA/threads/T1" },
    },
    ...overrides,
  };
}

/** What the scripted Google saw, and how it answers. */
export interface ScriptedGoogle {
  readonly fetch: FetchLike;
  keyReads: number;
  tokenExchanges: number;
  readonly sends: Array<{ url: string; text: string; authorization: string | null }>;
  /** Answer the next key reads with this status instead of the key set. */
  keyStatus: number;
  /** Answer token requests with this status (200 issues a token). */
  tokenStatus: number;
  /** Never answer a token request (only an abort ends it). */
  tokenHangs: boolean;
  /** `expires_in` of issued tokens, in seconds. */
  tokenLifetimeS: number;
  /** The last token request's form fields. */
  lastTokenForm: URLSearchParams | undefined;
  /** The signal the last token request carried. */
  lastTokenSignal: AbortSignal | undefined;
  /** Answer sends with this status. */
  sendStatus: number;
}

export function scriptedGoogle(): ScriptedGoogle {
  const google: ScriptedGoogle = {
    keyReads: 0,
    tokenExchanges: 0,
    sends: [],
    keyStatus: 200,
    tokenStatus: 200,
    tokenHangs: false,
    tokenLifetimeS: 3600,
    lastTokenForm: undefined,
    lastTokenSignal: undefined,
    sendStatus: 200,
    fetch: async (input, init) => {
      if (input === CERTS_URL) return keySetAnswer(google);
      if (input === TOKEN_URL) return tokenAnswer(google, init);
      if (input.startsWith("https://chat.googleapis.com/v1/"))
        return sendAnswer(google, input, init);
      throw new Error(`unexpected fetch to ${input}`);
    },
  };
  return google;
}

function keySetAnswer(google: ScriptedGoogle): Response {
  google.keyReads += 1;
  if (google.keyStatus !== 200) return new Response("", { status: google.keyStatus });
  return Response.json(publishedKeySet(), {
    headers: { "cache-control": "public, max-age=22195, must-revalidate" },
  });
}

async function tokenAnswer(
  google: ScriptedGoogle,
  init: RequestInit | undefined,
): Promise<Response> {
  google.tokenExchanges += 1;
  google.lastTokenForm = new URLSearchParams(String(init?.body ?? ""));
  google.lastTokenSignal = init?.signal ?? undefined;
  if (google.tokenHangs) return hangUntilAborted(init?.signal);
  if (google.tokenStatus !== 200) {
    return Response.json({ error: "invalid_grant" }, { status: google.tokenStatus });
  }
  return Response.json({
    access_token: `token-${google.tokenExchanges}`,
    expires_in: google.tokenLifetimeS,
    token_type: "Bearer",
  });
}

function sendAnswer(google: ScriptedGoogle, url: string, init: RequestInit | undefined): Response {
  const headers = new Headers(init?.headers);
  const text = (JSON.parse(String(init?.body)) as { text: string }).text;
  google.sends.push({ url, text, authorization: headers.get("authorization") });
  if (google.sendStatus !== 200) return new Response("{}", { status: google.sendStatus });
  const space = /\/v1\/(spaces\/[^/]+)\/messages$/.exec(url)?.[1] ?? "spaces/unknown";
  return Response.json({ name: `${space}/messages/OUT${google.sends.length}` });
}

function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });
}
