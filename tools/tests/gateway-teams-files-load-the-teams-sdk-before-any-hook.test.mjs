/**
 * B-545. The Teams SDK middleware's first `import()` costs 1.5 to 2.0 s under load, and a gateway-teams
 * test file that leaves it to the verifier pays it inside its first SDK-reaching test, past vitest's
 * 5 s budget. A hook is no better: `hookTimeout` budgets it the same way. These sixteen files must
 * therefore have the middleware loaded before their first hook runs, which is module scope.
 *
 * One nested vitest runs the sixteen files and three controls in the gateway-teams package, with a
 * setup file that records, before each file's own hooks, whether the middleware is in
 * `require.cache` and which worker ran the file. The controls prove the recorder can tell a
 * module-scope preload from an import inside a test or inside the file's own `beforeAll`, and the
 * pids prove no worker carried another file's import.
 *
 * The list of files is closed: a seventeenth gateway-teams test file that reaches the SDK through
 * the verifier must preload the middleware at module scope AND be added to PRELOADED_FILES, or
 * nothing here checks it.
 *
 * It lives here, not in gateway-teams, because the nested run needs a hook budget above anything a
 * gateway-teams test file may declare (B-545 forbids adding one there).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startVitest } from "vitest/node";

const PACKAGE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/gateway-teams",
);
const FIXTURES = "tests/fixtures/sdk-preload";

const PRELOADED_FILES = [
  "tests/forged-key-ids-read-the-key-set-at-most-once-per-interval.test.ts",
  "tests/a-key-not-endorsed-for-teams-cannot-sign-a-teams-activity.test.ts",
  "tests/a-cold-start-with-no-readable-key-set-says-key-set-unavailable.test.ts",
  "tests/a-forged-or-unsigned-activity-is-refused.test.ts",
  "tests/a-forged-token-naming-a-published-key-reaches-no-key-client.test.ts",
  "tests/a-genuine-token-whose-key-the-sdk-cannot-read-is-key-set-unavailable.test.ts",
  "tests/a-key-set-read-failure-says-what-failed.test.ts",
  "tests/a-refused-token-writes-nothing-to-the-console.test.ts",
  "tests/a-signed-activity-is-accepted-from-a-plain-request.test.ts",
  "tests/a-token-for-another-app-is-refused.test.ts",
  "tests/a-token-from-another-tenant-is-refused.test.ts",
  "tests/a-validator-module-in-the-options-never-replaces-the-sdk.test.ts",
  "tests/an-activity-from-another-channel-is-refused.test.ts",
  "tests/every-refusal-says-why-in-its-message.test.ts",
  "tests/the-test-key-server-signs-tokens-the-sdk-accepts.test.ts",
  "tests/the-verifier-reads-the-sdk-validator-under-either-name.test.ts",
];
const PRELOAD_CONTROL = `${FIXTURES}/preload.fixture.ts`;
const NO_PRELOAD_CONTROL = `${FIXTURES}/no-preload.fixture.ts`;
const HOOK_PRELOAD_CONTROL = `${FIXTURES}/hook-preload.fixture.ts`;
const ALL_FILES = [...PRELOADED_FILES, PRELOAD_CONTROL, NO_PRELOAD_CONTROL, HOOK_PRELOAD_CONTROL];

// Nineteen files plus the package's globalSetup (an RSA key pool) on two workers. Measured
// 2026-10-22 on 12 cores: 18.1 s and 24.5 s alone at load 10, 20.5 s inside `pnpm -r run test` at
// load 19 to 22. The budget is five times the slowest of those, for a host at load 30 to 40, and
// short enough that a hung nested run (globalSetup, a stuck fork) fails the suite in two minutes.
const NESTED_RUN_BUDGET_MS = 120_000;

const tempDir = mkdtempSync(join(tmpdir(), "gateway-teams-sdk-load-"));
const recordFile = join(tempDir, "records.jsonl");
/** @type {Map<string, { loaded: boolean, pid: number }[]>} */
const recordsByFile = new Map();
/** @type {Map<string, string>} */
const stateByFile = new Map();
/** @type {string[]} */
const collectedFiles = [];

async function runNested() {
  const previousRecordFile = process.env.SDK_LOAD_RECORD_FILE;
  const previousExitCode = process.exitCode;
  process.env.SDK_LOAD_RECORD_FILE = recordFile;
  try {
    const vitest = await startVitest("test", ALL_FILES, {
      root: PACKAGE_DIR,
      config: join(PACKAGE_DIR, "vitest.config.ts"),
      run: true,
      watch: false,
      reporters: [],
      include: ["tests/**/*.test.ts", `${FIXTURES}/*.fixture.ts`],
      // The package config forks cpus - 4 workers, and this run shares the machine with every other
      // package suite under `pnpm -r run test`. Two are enough: each file still gets its own fork
      // (vitest isolates per file), which is what no_worker_runs_two_files checks.
      maxWorkers: 2,
      setupFiles: [`${FIXTURES}/record-sdk-load.setup.ts`],
    });
    try {
      for (const module of vitest.state.getTestModules()) {
        const file = relative(PACKAGE_DIR, module.moduleId);
        collectedFiles.push(file);
        stateByFile.set(file, module.state());
      }
    } finally {
      await vitest.close();
    }
  } finally {
    process.exitCode = previousExitCode;
    if (previousRecordFile === undefined) delete process.env.SDK_LOAD_RECORD_FILE;
    else process.env.SDK_LOAD_RECORD_FILE = previousRecordFile;
  }
  let lines = [];
  try {
    lines = readFileSync(recordFile, "utf8").split("\n").filter(Boolean);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const line of lines) {
    const { file, loaded, pid } = JSON.parse(line);
    const key = relative(PACKAGE_DIR, file);
    recordsByFile.set(key, [...(recordsByFile.get(key) ?? []), { loaded, pid }]);
  }
}

beforeAll(runNested, NESTED_RUN_BUDGET_MS);

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const loadedBeforeHooks = (file) => recordsByFile.get(file)?.[0]?.loaded;

describe("the sixteen gateway-teams files that reach the Teams SDK", () => {
  it("the_nested_run_collected_exactly_the_named_files", () => {
    expect([...collectedFiles].sort()).toEqual([...ALL_FILES].sort());
  });

  it("every_named_file_left_one_record", () => {
    const withoutRecord = ALL_FILES.filter((file) => recordsByFile.get(file)?.length !== 1);
    expect(withoutRecord, "files with no single record before their hooks").toEqual([]);
  });

  it("the_controls_tell_a_preload_from_an_import_in_a_test", () => {
    expect({
      preload: loadedBeforeHooks(PRELOAD_CONTROL),
      noPreload: loadedBeforeHooks(NO_PRELOAD_CONTROL),
      hookPreload: loadedBeforeHooks(HOOK_PRELOAD_CONTROL),
    }).toEqual({ preload: true, noPreload: false, hookPreload: false });
  });

  it("the_negative_control_ran_and_saw_the_sdk_after_its_test", () => {
    expect(stateByFile.get(NO_PRELOAD_CONTROL)).toBe("passed");
  });

  it("no_worker_runs_two_files", () => {
    const pids = ALL_FILES.flatMap((file) => (recordsByFile.get(file) ?? []).map((r) => r.pid));
    expect(pids).toHaveLength(ALL_FILES.length);
    expect(new Set(pids).size).toBe(ALL_FILES.length);
  });

  it("the_sixteen_files_have_the_teams_sdk_loaded_before_any_hook", () => {
    const notLoaded = PRELOADED_FILES.filter((file) => loadedBeforeHooks(file) !== true);
    expect(notLoaded, "files whose first hook ran without the SDK middleware loaded").toEqual([]);
  });
});
