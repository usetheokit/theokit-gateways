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
 * Usage: node scripts/check-peer-major.mjs <package-name> <dep> <version>
 *
 * The VERSION, not the major. `^7` is not a way to ask for a major: semver excludes prereleases
 * from a caret range, so `^7` matches nothing when the only published 7.x is `7.0.0-rc14` — the
 * case `baileys >=7.0.0-rc14` presents, and how this was found. `peer-majors.mjs` resolves the
 * concrete version, so this script installs a fact rather than constructing a range.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MANIFEST = join(ROOT, "package.json");
const BACKUP = join(ROOT, "package.json.peer-major-backup");

const [pkg, dep, version] = process.argv.slice(2);
if (!pkg || !dep || !version) {
  console.error("usage: node scripts/check-peer-major.mjs <package-name> <dep> <version>");
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
    console.error(
      `\nCOULD NOT RESTORE ${MANIFEST} — restore it from ${BACKUP} by hand before doing anything else.`,
    );
  }
}

copyFileSync(MANIFEST, BACKUP);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    restore();
    process.exit(130);
  });

let failure;
try {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  manifest.pnpm ??= {};
  manifest.pnpm.overrides = { ...manifest.pnpm.overrides, [dep]: version };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\n── ${pkg} against ${dep}@${version} ──\n`);
  run("pnpm", ["install", "--no-frozen-lockfile"]);

  // Build the workspace dependencies FIRST. A package here resolves its siblings through their
  // `dist/`, so `tsc --noEmit` cannot see `@theokit/gateway`'s types until that package is built.
  // Locally this passed without the step and failed on the first CI run, because a developer's
  // tree already carries a `dist/` from an earlier build and a fresh checkout does not — the whole
  // class of bug where a check is verified only under state the real pipeline never has.
  // `<pkg>^...` is pnpm's selector for "the dependencies of, excluding itself". The mirrored form
  // `...^<pkg>` means DEPENDENTS, and reaches for the integration suite instead — measured, because
  // the first version of this line used it and failed with "None of the selected packages has a
  // build script".
  run("pnpm", ["--filter", `${pkg}^...`, "build"]);

  for (const script of ["typecheck", "test", "build"]) {
    run("pnpm", ["--filter", pkg, script]);
  }
} catch (err) {
  failure = err;
} finally {
  restore();
}

if (failure !== undefined) {
  console.error(`\nFAIL  ${pkg} does not hold against ${dep}@${version}`);
  process.exit(1);
}
console.log(`\nPASS  ${pkg} holds against ${dep}@${version}`);
