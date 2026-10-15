/**
 * An RSA-2048 key pair costs about 40 ms to generate on an idle machine and several times that
 * under load, and a test that starts a key server with 8 keys paid it inside its own 5-second
 * budget: three such tests timed out in a full-suite run at load 29.6 (review finding F-xval-19).
 * The pairs are now generated once, before any test file runs, and handed out from a pool, so a
 * test's time is spent on the behaviour it checks.
 */

import { describe, expect, it, vi } from "vitest";

const keyGeneration = vi.hoisted(() => ({ calls: 0 }));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  const generateKeyPairSync: typeof actual.generateKeyPairSync = (...args: unknown[]) => {
    keyGeneration.calls += 1;
    return (actual.generateKeyPairSync as (...a: unknown[]) => never)(...args);
  };
  return { ...actual, generateKeyPairSync };
});

const { startKeyServer } = await import("./helpers/key-server.js");

describe("the test key server", () => {
  it("generates no key pair when it starts with 8 published keys", async () => {
    const ks = await startKeyServer({ extraKeys: 7 });
    try {
      expect(ks.publishedKids()).toHaveLength(8);
      expect(keyGeneration.calls).toBe(0);
    } finally {
      await ks.close();
    }
  });

  it("publishes a different key under every kid, across servers in one file", async () => {
    const servers = [
      await startKeyServer({ extraKeys: 7 }),
      await startKeyServer({ extraKeys: 7 }),
      await startKeyServer({ separateTenantKeys: true }),
    ];
    try {
      const moduli = servers.flatMap((ks) => ks.publishedJwks().map((jwk) => jwk.n));
      expect(moduli.length).toBeGreaterThanOrEqual(17);
      expect(new Set(moduli).size).toBe(moduli.length);
    } finally {
      await Promise.all(servers.map((ks) => ks.close()));
    }
  });
});
