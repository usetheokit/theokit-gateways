/**
 * `connect()` must ask Microsoft before reporting success.
 *
 * Measured 2026-08-28 with a client id of all zeros and an invented secret: `connect()` returned
 * `true` in 474ms. The SDK's `initialize()` builds local state and validates no credential, so the
 * adapter was reporting a connection it had never established — and every sibling had already been
 * fixed for exactly this (`fix(whatsapp): connect() asks Meta before reporting success`; LINE calls
 * `getBotInfo()`). Teams was the one left, and it was invisible because its live suite has never
 * run: the credentials to run it do not exist here.
 *
 * The adapter's own live test asserts this contract — "returns false rather than throwing on a
 * secret Azure rejects" — so the behaviour was declared and unimplemented, which is worse than
 * undeclared: it reads as covered.
 */

import { describe, expect, it } from "vitest";

import { TeamsAdapter } from "../src/adapter.js";

/** A fake App: initialize() succeeds, exactly as the real SDK's does with any credentials. */
function fakeApp() {
  return {
    on() {},
    initialize: async () => {},
    stop: async () => {},
    send: async () => ({ id: "1" }),
  };
}

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return new TeamsAdapter({
    // Deliberately DISTINCT: with the same uuid in both slots, a connect that asked about the wrong
    // one would still look right. Placeholder values, so nothing here is a credential.
    clientId: "11111111-1111-1111-1111-111111111111",
    clientSecret: "not-a-real-secret",
    tenantId: "22222222-2222-2222-2222-222222222222",
    __appFactory: () => fakeApp() as never,
    ...overrides,
  } as never);
}

describe("connect verifies the credential", () => {
  it("returns false when Microsoft rejects the credential", async () => {
    const adapter = makeAdapter({
      // Entra's own answer to a bad client_credentials grant.
      __tokenFetcher: async () => ({ ok: false, status: 401, error: "invalid_client" }),
    });
    try {
      expect(await adapter.connect()).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });

  it("returns true when Microsoft issues a token", async () => {
    // ...having asked about THIS app. The stub answers yes to anything, so `true` alone proves the
    // call happened and nothing about what it carried: an adapter passing the appId where the
    // clientId belongs, or a tenant it did not read from its own options, verifies a credential
    // nobody configured and reports the gateway ready.
    let asked: { clientId?: string; clientSecret?: string; tenantId?: string } | undefined;
    const adapter = makeAdapter({
      __tokenFetcher: async (opts: {
        clientId: string;
        clientSecret: string;
        tenantId: string;
      }) => {
        asked = opts;
        return { ok: true, status: 200 };
      },
    });
    try {
      expect(await adapter.connect()).toBe(true);
    } finally {
      await adapter.disconnect();
    }
    expect(asked, "connect() verified a credential other than its own").toEqual({
      clientId: "11111111-1111-1111-1111-111111111111",
      clientSecret: "not-a-real-secret",
      tenantId: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("returns false rather than throwing when the token request itself fails", async () => {
    // A DNS failure or a dropped connection is not a programmer error, and EC-7 forbids throwing
    // from connect() on a platform error.
    const adapter = makeAdapter({
      __tokenFetcher: async () => {
        throw new Error("getaddrinfo ENOTFOUND login.microsoftonline.com");
      },
    });
    try {
      expect(await adapter.connect()).toBe(false);
    } finally {
      await adapter.disconnect();
    }
  });
});
