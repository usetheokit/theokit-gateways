/**
 * B-532. Four route tests timed out under machine load. Two causes were measured: the Teams SDK's
 * first import (see the preload in each file) and RSA key generation inside a test. This file holds
 * the second: a key a test signs with comes from the global-setup pool, and none of the four files
 * generates an RSA key or waits on a fixed duration.
 */

import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, inject, it } from "vitest";

import { unusedKeyPair } from "./helpers/key-server.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const FILES = [
  "a-service-url-claim-that-differs-is-refused.test.ts",
  "a-key-microsoft-stopped-publishing-causes-no-key-set-request.test.ts",
  "the-readme-route-answers-each-verdict-with-its-status.test.ts",
  "a-key-set-with-no-usable-rsa-key-is-a-failed-read.test.ts",
];

describe("the route tests' keys", () => {
  it("come from the pool the global setup generated", () => {
    const pool = inject("signingKeyPool");
    expect(pool.length).toBeGreaterThan(0);
    const pooled = new Set(
      pool.map((pair) => createPublicKey(pair.publicKey).export({ format: "jwk" }).n),
    );

    const drawn = unusedKeyPair().publicKey.export({ format: "jwk" }).n;

    expect(pooled.has(drawn)).toBe(true);
  });

  for (const file of FILES) {
    it(`${file} generates no RSA key and waits on no fixed duration`, () => {
      const source = readFileSync(join(TESTS_DIR, file), "utf8");

      expect(source).not.toMatch(/generateKeyPair(Sync)?\(\s*["']rsa["']/);
      expect(source).not.toMatch(/\bsetTimeout\b|\bsleep\b/);
    });
  }
});
