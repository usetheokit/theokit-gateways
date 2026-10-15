/**
 * Generates the RSA key pairs the test key server hands out, once, before any test file runs.
 *
 * A pair costs about 40 ms on an idle machine and several times that under load. Paid inside a
 * test, eight of them took a test past its 5-second budget in a loaded full-suite run. Generated
 * here, the cost is paid once per run and outside every test's timeout. The pairs are made at run
 * time and never written to disk, so no key material is ever committed.
 */

import { generateKeyPair } from "node:crypto";
import { promisify } from "node:util";
import type { TestProject } from "vitest/node";

/**
 * How many pairs to generate. A file that draws more than this generates the rest on demand, so
 * the size bounds the run's start-up cost, not what a test may use.
 */
const POOL_SIZE = 96;

const generate = promisify(generateKeyPair);

export default async function setup(project: TestProject): Promise<void> {
  const pairs = await Promise.all(
    Array.from({ length: POOL_SIZE }, () =>
      generate("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      }),
    ),
  );
  project.provide("signingKeyPool", pairs);
}

declare module "vitest" {
  export interface ProvidedContext {
    /** RSA-2048 key pairs as PEM, generated once per run by this setup. */
    signingKeyPool: readonly { readonly publicKey: string; readonly privateKey: string }[];
  }
}
