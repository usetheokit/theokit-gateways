import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleChatAdapter } from "../src/index.js";
import {
  APP_PRIVATE_KEY_PEM,
  AUDIENCE,
  chatClaims,
  GOOGLE_KID,
  idToken,
  messageEvent,
  NOW_MS,
  type ScriptedGoogle,
  SERVICE_ACCOUNT,
  scriptedGoogle,
} from "./fixtures.js";

function adapterWith(google: ScriptedGoogle): {
  adapter: GoogleChatAdapter;
  events: MessageEvent[];
} {
  const adapter = new GoogleChatAdapter({
    serviceAccountEmail: SERVICE_ACCOUNT,
    privateKey: APP_PRIVATE_KEY_PEM,
    audience: AUDIENCE,
    fetch: google.fetch,
    now: () => NOW_MS,
  });
  const events: MessageEvent[] = [];
  adapter.onInbound(async (event) => {
    events.push(event);
  });
  return { adapter, events };
}

/** Post one MESSAGE event with `authorization`, and let a delivered event reach the handler. */
async function post(adapter: GoogleChatAdapter, authorization: string | undefined) {
  const answer = await adapter.handleRequest(authorization, JSON.stringify(messageEvent()));
  await new Promise((resolve) => setImmediate(resolve));
  return answer;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Google Chat inbound token", () => {
  it("a correctly signed token is delivered", async () => {
    const { adapter, events } = adapterWith(scriptedGoogle());

    const answer = await post(adapter, `Bearer ${idToken()}`);

    expect(answer).toEqual({ status: 200, body: {} });
    expect(events.map((e) => e.text)).toEqual(["hello there"]);
  });

  const refusals: ReadonlyArray<[string, () => string | undefined]> = [
    [
      "refuses a token for another audience",
      () => `Bearer ${idToken(chatClaims({ aud: "https://other.example.com" }))}`,
    ],
    [
      "refuses a token whose email is not Chat's",
      () => `Bearer ${idToken(chatClaims({ email: "someone@example.com" }))}`,
    ],
    [
      "refuses a token whose email is not verified",
      () => `Bearer ${idToken(chatClaims({ email_verified: false }))}`,
    ],
    [
      "refuses a token from another issuer",
      () => `Bearer ${idToken(chatClaims({ iss: "https://evil.example.com" }))}`,
    ],
    [
      "refuses an expired token",
      () => `Bearer ${idToken(chatClaims({ exp: NOW_MS / 1000 - 61 }))}`,
    ],
    [
      "refuses a token signed by an unpublished key",
      () => `Bearer ${idToken(chatClaims(), { signedByStranger: true })}`,
    ],
    [
      "refuses a token naming a key Google never published",
      () => `Bearer ${idToken(chatClaims(), { kid: "made-up" })}`,
    ],
    ["refuses a request with no Authorization header", () => undefined],
    ["refuses a header that is not a JWT", () => "Bearer not-a-token"],
  ];

  it.each(refusals)("%s", async (_name, header) => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { adapter, events } = adapterWith(scriptedGoogle());

    const answer = await post(adapter, header());

    expect(answer.status).toBe(401);
    expect(events).toEqual([]);
  });

  it("accepts a token within the 60 s skew past exp", async () => {
    const { adapter, events } = adapterWith(scriptedGoogle());

    const answer = await post(
      adapter,
      `Bearer ${idToken(chatClaims({ exp: NOW_MS / 1000 - 59 }))}`,
    );

    expect(answer.status).toBe(200);
    expect(events).toHaveLength(1);
  });

  it("an unreadable key set answers 503, not 401", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const google = scriptedGoogle();
    google.keyStatus = 500;
    const { adapter, events } = adapterWith(google);

    const answer = await post(adapter, `Bearer ${idToken()}`);

    expect(answer.status).toBe(503);
    expect(events).toEqual([]);
  });

  it("answers 503 and delivers nothing when no handler is registered", async () => {
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: APP_PRIVATE_KEY_PEM,
      audience: AUDIENCE,
      fetch: scriptedGoogle().fetch,
      now: () => NOW_MS,
    });

    const answer = await post(adapter, `Bearer ${idToken()}`);

    expect(answer.status).toBe(503);
  });

  it("refuses a token whose header names alg none, even with Google's kid", async () => {
    const { adapter, events } = adapterWith(scriptedGoogle());
    const [, claims] = idToken().split(".");
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT", kid: GOOGLE_KID }),
    ).toString("base64url");

    const answer = await post(adapter, `Bearer ${header}.${claims}.`);

    expect(answer.status).toBe(401);
    expect(events).toEqual([]);
  });

  it("answers 400 to a verified request whose body is JSON but not an object", async () => {
    const { adapter, events } = adapterWith(scriptedGoogle());

    const answer = await adapter.handleRequest(`Bearer ${idToken()}`, "null");

    expect(answer.status).toBe(400);
    expect(events).toEqual([]);
  });
});
