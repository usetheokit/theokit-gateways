/**
 * Setup file for the nested run in
 * `tools/tests/the-key-set-reads-test-spends-its-body-on-the-verifier.test.mjs` (B-533). While a
 * test body runs, it counts every private-key operation the package's `tests/` code makes through
 * `node:crypto`: `sign`, the `sign()` of a `createSign` object, `generateKeyPairSync` and
 * `generateKeyPair`. Calls from `src/` and from dependencies are not counted: the verifier's own
 * work is what the test is about. Before the file's own hooks it records whether the Teams SDK
 * middleware is already loaded. After the file's tests it appends one JSON line, the file's path
 * and its counts, to the file `FIXTURE_CRYPTO_RECORD_FILE` names.
 */

import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";

const recordFile = process.env.FIXTURE_CRYPTO_RECORD_FILE;
if (recordFile === undefined) {
  throw new Error("count-fixture-crypto.setup.ts: FIXTURE_CRYPTO_RECORD_FILE is not set");
}

const counts = vi.hoisted(() => ({
  inBody: false,
  sign: 0,
  createSign: 0,
  keygen: 0,
  asyncKeygen: 0,
  sdkLoadedBeforeHooks: false,
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  // The first package frame below this file decides: a frame under `tests/` is fixture work, a
  // frame under `src/` is the verifier's own. This file sits under `tests/` too, so its frames
  // are skipped before the search.
  const calledFromTests = (): boolean => {
    const frames = (new Error().stack ?? "").split("\n").slice(1);
    const caller = frames.find(
      (line) =>
        line.includes("/packages/gateway-teams/") && !line.includes("count-fixture-crypto.setup"),
    );
    return caller?.includes("/packages/gateway-teams/tests/") === true;
  };
  const counted = (counter: "sign" | "createSign" | "keygen" | "asyncKeygen"): void => {
    if (counts.inBody && calledFromTests()) counts[counter] += 1;
  };

  const sign = ((...args: Parameters<typeof actual.sign>) => {
    counted("sign");
    return Reflect.apply(actual.sign, actual, args);
  }) as typeof actual.sign;
  const createSign = ((...args: Parameters<typeof actual.createSign>) => {
    const signer = actual.createSign(...args);
    const signOnce = signer.sign.bind(signer);
    signer.sign = ((...signArgs: Parameters<typeof signOnce>) => {
      counted("createSign");
      return Reflect.apply(signOnce, signer, signArgs);
    }) as typeof signer.sign;
    return signer;
  }) as typeof actual.createSign;
  const generateKeyPairSync = ((...args: Parameters<typeof actual.generateKeyPairSync>) => {
    counted("keygen");
    return Reflect.apply(actual.generateKeyPairSync, actual, args);
  }) as typeof actual.generateKeyPairSync;
  const generateKeyPair = ((...args: Parameters<typeof actual.generateKeyPair>) => {
    counted("asyncKeygen");
    return Reflect.apply(actual.generateKeyPair, actual, args);
  }) as typeof actual.generateKeyPair;
  // Keep `promisify(generateKeyPair)` resolving to both keys, as Node's own does.
  const promisified = promisify(actual.generateKeyPair);
  Object.assign(generateKeyPair, {
    [promisify.custom]: (...args: unknown[]) => {
      counted("asyncKeygen");
      return Reflect.apply(promisified, actual, args);
    },
  });

  const wrapped = { sign, createSign, generateKeyPairSync, generateKeyPair };
  return { ...actual, ...wrapped, default: { ...actual, ...wrapped } };
});

const require = createRequire(import.meta.url);
const SDK_MIDDLEWARE = require.resolve("@microsoft/teams.apps/dist/middleware/index.js");

let testFile: string | undefined;

beforeAll(() => {
  testFile = expect.getState().testPath;
  if (testFile === undefined) {
    throw new Error(
      "count-fixture-crypto.setup.ts: expect.getState().testPath is undefined in beforeAll, so this record cannot name its file",
    );
  }
  counts.sdkLoadedBeforeHooks = SDK_MIDDLEWARE in require.cache;
});

beforeEach(() => {
  counts.inBody = true;
});

afterEach(() => {
  counts.inBody = false;
});

afterAll(() => {
  const { inBody: _inBody, ...record } = counts;
  appendFileSync(recordFile, `${JSON.stringify({ file: testFile, ...record })}\n`);
});
