/**
 * B-533. `key-set-reads-stay-at-one-per-interval-whatever-is-sent.test.ts` sends 1000 forged
 * requests and checks that each key set is read once. Measured in isolation, 80 to 89% of its body
 * was its own fixture work: 1000 RS256 signatures with a 2048-bit key (59 to 77%), one RSA key
 * generation, and the Teams SDK middleware's first import inside the first `verify`. That work is
 * CPU-bound, so machine load stretches it, and at a load of 42 to 53 on 12 cores the test ran past
 * its 30 s budget. The verifier's own work on the 999 later requests was 4 to 8%.
 *
 * A nested vitest runs that one file with a setup that counts, while its test body runs, every
 * private-key operation (`sign`, `createSign().sign`, `generateKeyPairSync`, `generateKeyPair`)
 * made from the package's `tests/` code, and records whether the SDK middleware is loaded before
 * the file's hooks. The forged requests need no private-key work: a forgery is refused whatever
 * its signature bytes are. A control file that signs and generates a key inside its tests runs
 * beside it, so a counter that stopped counting fails here instead of reading 0.
 *
 * It lives here, not in gateway-teams, for the reason the B-545 guard beside it gives: the nested
 * run needs a budget no gateway-teams test file may declare.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startVitest } from "vitest/node";

const PACKAGE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/gateway-teams",
);
const TARGET = "tests/key-set-reads-stay-at-one-per-interval-whatever-is-sent.test.ts";
// Signs with `sign` in its tests and generates an EC key inside one, and never loads the SDK.
const CONTROL = "tests/an-rs256-signature-verifies-only-under-its-key.test.ts";
const COUNTING_SETUP = "tests/fixtures/fixture-crypto/count-fixture-crypto.setup.ts";

// Two files and the package's globalSetup (an RSA key pool). The target took 5 to 33 s under load
// before B-533; the budget leaves room for the pool and a loaded host, and still fails a hung
// nested run within five minutes.
const NESTED_RUN_BUDGET_MS = 300_000;

const tempDir = mkdtempSync(join(tmpdir(), "gateway-teams-fixture-crypto-"));
const recordFile = join(tempDir, "records.jsonl");

/**
 * @typedef {{ sign: number, createSign: number, keygen: number, asyncKeygen: number,
 *   sdkLoadedBeforeHooks: boolean }} FixtureCryptoRecord
 */

/** @type {Map<string, string>} */
const stateByFile = new Map();

/**
 * The record the counting setup wrote for `testFile`, or an error naming the missing record and how
 * that file ended, so a failed nested run reads as what it was rather than as a bare ENOENT.
 *
 * @param {string} records the JSONL file the setup appends to
 * @param {string} testFile a path relative to the package
 * @param {string | undefined} state the file's module state in the nested run
 * @returns {FixtureCryptoRecord}
 */
function readRecord(records, testFile, state) {
  const lines = existsSync(records) ? readFileSync(records, "utf8").split("\n") : [];
  const record = lines
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((entry) => relative(PACKAGE_DIR, entry.file) === testFile);
  if (record === undefined) {
    throw new Error(
      `the counting setup left no record for ${testFile} in ${records}; its module state was ${state ?? "never collected"}`,
    );
  }
  return record;
}

/** @param {string} testFile */
const recordOf = (testFile) => readRecord(recordFile, testFile, stateByFile.get(testFile));

async function runNested() {
  const previousRecordFile = process.env.FIXTURE_CRYPTO_RECORD_FILE;
  const previousExitCode = process.exitCode;
  process.env.FIXTURE_CRYPTO_RECORD_FILE = recordFile;
  try {
    const vitest = await startVitest("test", [TARGET, CONTROL], {
      root: PACKAGE_DIR,
      config: join(PACKAGE_DIR, "vitest.config.ts"),
      run: true,
      watch: false,
      reporters: [],
      setupFiles: [COUNTING_SETUP],
    });
    try {
      for (const module of vitest.state.getTestModules()) {
        stateByFile.set(relative(PACKAGE_DIR, module.moduleId), module.state());
      }
    } finally {
      await vitest.close();
    }
  } finally {
    process.exitCode = previousExitCode;
    if (previousRecordFile === undefined) delete process.env.FIXTURE_CRYPTO_RECORD_FILE;
    else process.env.FIXTURE_CRYPTO_RECORD_FILE = previousRecordFile;
  }
}

beforeAll(runNested, NESTED_RUN_BUDGET_MS);

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("the 1000-request key-set test", () => {
  it("still_passes_under_the_counting_setup", () => {
    expect(stateByFile.get(TARGET)).toBe("passed");
  });

  it("the_control_shows_the_counters_count_work_done_in_a_test_body", () => {
    const { sign, keygen, sdkLoadedBeforeHooks } = recordOf(CONTROL);
    expect(stateByFile.get(CONTROL)).toBe("passed");
    expect({ signs: sign > 0, generates: keygen > 0, sdkLoadedBeforeHooks }).toEqual({
      signs: true,
      generates: true,
      sdkLoadedBeforeHooks: false,
    });
  });

  it("makes_no_rsa_signature_from_test_code_while_its_body_runs", () => {
    expect(recordOf(TARGET).sign).toBe(0);
  });

  it("generates_no_key_pair_while_its_body_runs", () => {
    expect(recordOf(TARGET).keygen).toBe(0);
  });

  it("has_the_teams_sdk_loaded_before_its_hooks", () => {
    expect(recordOf(TARGET).sdkLoadedBeforeHooks).toBe(true);
  });

  it("counts_signatures_made_through_create_sign_and_async_key_generation", () => {
    const { sign, createSign, keygen, asyncKeygen } = recordOf(TARGET);
    expect({ sign, createSign, keygen, asyncKeygen }).toEqual({
      sign: 0,
      createSign: 0,
      keygen: 0,
      asyncKeygen: 0,
    });
  });

  it("every_case_names_a_missing_record", () => {
    const absent = join(tempDir, "absent.jsonl");
    expect(() => readRecord(absent, TARGET, "failed")).toThrow(
      `the counting setup left no record for ${TARGET} in ${absent}; its module state was failed`,
    );
  });
});
