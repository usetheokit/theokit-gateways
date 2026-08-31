#!/usr/bin/env node
/**
 * Verify one package against one major of one third-party peer.
 *
 * Installs the major through pnpm's own `overrides` — the native mechanism, so nothing here
 * reimplements resolution — then runs that package's `typecheck`, `test` and `build`.
 *
 * The root manifest and the lockfile are ALWAYS restored, including on a crash or a signal. A run
 * that leaves an override behind silently changes what every later command resolves, which is a
 * worse failure than the one it was investigating.
 *
 * Usage: node scripts/check-peer-major.mjs <package-name> <dep> <major>
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MANIFEST = join(ROOT, "package.json");
const BACKUP = join(ROOT, "package.json.peer-major-backup");

const [pkg, dep, major] = process.argv.slice(2);
if (!pkg || !dep || !major) {
  console.error("usage: node scripts/check-peer-major.mjs <package-name> <dep> <major>");
  process.exit(2);
}

function run(command, args, opts = {}) {
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit", ...opts });
}

function restore() {
  try {
    copyFileSync(BACKUP, MANIFEST);
    rmSync(BACKUP, { force: true });
    // The lockfile moved with the override; put it back so the next command resolves what the
    // committed tree says it resolves.
    run("git", ["restore", "pnpm-lock.yaml"], { stdio: "ignore" });
  } catch {
    console.error(`\nCOULD NOT RESTORE ${MANIFEST} — restore it from ${BACKUP} by hand before doing anything else.`);
  }
}

copyFileSync(MANIFEST, BACKUP);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { restore(); process.exit(130); });

let failure;
try {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  manifest.pnpm ??= {};
  manifest.pnpm.overrides = { ...manifest.pnpm.overrides, [dep]: `^${major}` };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\n── ${pkg} against ${dep}@^${major} ──\n`);
  run("pnpm", ["install", "--no-frozen-lockfile"]);
  for (const script of ["typecheck", "test", "build"]) {
    run("pnpm", ["--filter", pkg, script]);
  }
} catch (err) {
  failure = err;
} finally {
  restore();
}

if (failure !== undefined) {
  console.error(`\nFAIL  ${pkg} does not hold against ${dep}@^${major}`);
  process.exit(1);
}
console.log(`\nPASS  ${pkg} holds against ${dep}@^${major}`);
