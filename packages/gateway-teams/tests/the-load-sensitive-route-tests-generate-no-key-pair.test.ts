/**
 * An RSA-2048 key pair costs several times more under machine load, and a pair generated inside a
 * test spends that test's 5-second budget (B-532). The tests that timed out in a loaded run draw
 * their keys from the global-setup pool through `unusedKeyPair`, and generate none themselves.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

const FILES = [
  "a-service-url-claim-that-differs-is-refused.test.ts",
  "a-key-microsoft-stopped-publishing-causes-no-key-set-request.test.ts",
  "the-readme-route-answers-each-verdict-with-its-status.test.ts",
  "a-key-set-with-no-usable-rsa-key-is-a-failed-read.test.ts",
];

describe("the tests that timed out under load", () => {
  it.each(FILES)("%s generates no RSA key pair and waits on no fixed duration", (file) => {
    const source = readFileSync(join(HERE, file), "utf8");
    expect(source).not.toMatch(/generateKeyPair(Sync)?\(\s*"rsa"/);
    expect(source).not.toMatch(/setTimeout|\bsleep\(/);
  });
});
