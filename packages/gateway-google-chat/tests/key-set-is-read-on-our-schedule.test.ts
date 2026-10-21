import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleChatAdapter } from "../src/index.js";
import {
  APP_PRIVATE_KEY_PEM,
  AUDIENCE,
  chatClaims,
  idToken,
  messageEvent,
  NOW_MS,
  SERVICE_ACCOUNT,
  scriptedGoogle,
} from "./fixtures.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Google's key set", () => {
  it("ten tokens with unrecognised kids in one minute cause one key read", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const google = scriptedGoogle();
    let now = NOW_MS;
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: APP_PRIVATE_KEY_PEM,
      audience: AUDIENCE,
      fetch: google.fetch,
      now: () => now,
    });
    adapter.onInbound(async () => undefined);
    const body = JSON.stringify(messageEvent());

    // Ten at once share one read, then ten more over the next 59 s start none.
    const together = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        adapter.handleRequest(`Bearer ${idToken(chatClaims(), { kid: `unknown-${i}` })}`, body),
      ),
    );
    for (let i = 0; i < 10; i += 1) {
      now += 5_900;
      await adapter.handleRequest(`Bearer ${idToken(chatClaims(), { kid: `later-${i}` })}`, body);
    }

    expect(together.map((a) => a.status)).toEqual(Array(10).fill(401));
    expect(google.keyReads).toBe(1);
  });

  it("reads again for an unrecognised kid once 60 s have passed", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const google = scriptedGoogle();
    let now = NOW_MS;
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: APP_PRIVATE_KEY_PEM,
      audience: AUDIENCE,
      fetch: google.fetch,
      now: () => now,
    });
    const body = JSON.stringify(messageEvent());

    await adapter.handleRequest(`Bearer ${idToken(chatClaims(), { kid: "unknown-a" })}`, body);
    now += 60_000;
    await adapter.handleRequest(`Bearer ${idToken(chatClaims(), { kid: "unknown-b" })}`, body);

    expect(google.keyReads).toBe(2);
  });

  it("answers a listed kid from the cached set until its max-age passes", async () => {
    const google = scriptedGoogle();
    let now = NOW_MS;
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: APP_PRIVATE_KEY_PEM,
      audience: AUDIENCE,
      fetch: google.fetch,
      now: () => now,
    });
    adapter.onInbound(async () => undefined);
    const body = JSON.stringify(messageEvent());
    const valid = (): string =>
      `Bearer ${idToken(chatClaims({ iat: now / 1000, exp: now / 1000 + 3600 }))}`;

    await adapter.handleRequest(valid(), body);
    now += 22_194_000;
    await adapter.handleRequest(valid(), body);
    expect(google.keyReads).toBe(1);
    now += 2_000;
    await adapter.handleRequest(valid(), body);

    expect(google.keyReads).toBe(2);
  });

  it("reads a failing key endpoint at most once a minute, however many requests arrive", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const google = scriptedGoogle();
    google.keyStatus = 500;
    let now = NOW_MS;
    const adapter = new GoogleChatAdapter({
      serviceAccountEmail: SERVICE_ACCOUNT,
      privateKey: APP_PRIVATE_KEY_PEM,
      audience: AUDIENCE,
      fetch: google.fetch,
      now: () => now,
    });
    const body = JSON.stringify(messageEvent());

    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      statuses.push((await adapter.handleRequest(`Bearer ${idToken()}`, body)).status);
      now += 5_000;
    }

    expect(statuses).toEqual(Array(10).fill(503));
    expect(google.keyReads).toBe(1);
  });
});
