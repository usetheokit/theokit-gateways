#!/usr/bin/env node
// Published-declaration typecheck gate — raised by #29.
//
// The `.d.ts` we publish is the only contract a consumer reads before writing a line of code, and it
// can be broken in a way nothing else here notices. `skipLibCheck: true` is on by default in most
// consumer projects, so a declaration file that does not compile still installs, still imports and
// still looks fine — until someone runs type-aware lint, which resolves the real type graph and has
// no such escape. Then every type reached through the broken reference degrades to `error`, and the
// consumer gets `no-unsafe-*` on ordinary, correct calls into our adapters.
//
// `pnpm -r run typecheck` cannot see this: it compiles the SOURCE, which is correct. Measured
// 2026-08-20 on this repo at f08b901 — nine unresolved references across five of eleven packages,
// replicated identically in `.d.ts` and `.d.cts`, with every package's source typecheck green.
//
// So this gate does not read our source and does not match names. It asks the compiler the same
// question a consumer's type-aware lint asks, which is the only question that matters here.
//
// Deliberately NOT skipped when `dist/` is missing: a gate whose green can mean "there was nothing
// to check" reports absence it never checked.

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { publishedPackages, ROOT } from "./lib/published-entries.mjs";
import { readRepairStamp, repairRanOverBuild } from "./lib/repair-stamp.mjs";

const LABEL = "dts-typechecks";
const MAX_SHOWN = 12;

/**
 * There is deliberately NO waiver list. A name that cannot be bound means shipping a declaration
 * that breaks a consumer's lint — a regression to remove, never a threshold to tune. If a future
 * upstream defect leaves something genuinely unfixable, adding a waiver is a decision that deserves
 * its own commit and its own argument, not a slot standing open in advance.
 */

function diagnosticsFor(entries) {
  try {
    execFileSync(
      "npx",
      [
        "tsc",
        "--noEmit",
        "--strict",
        "--target",
        "es2022",
        "--module",
        "esnext",
        "--moduleResolution",
        "bundler",
        "--skipLibCheck",
        "false",
        ...entries,
      ],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return [];
  } catch (error) {
    // A FAILED INVOCATION IS NOT A CLEAN COMPILE. `tsc` exits non-zero with diagnostics on stdout; a
    // spawn that never ran (npx absent, ENOENT, a killed process) arrives here with a null status and
    // no stdout, and returning [] for that would print a green run having compiled nothing.
    if (typeof error.status !== "number") {
      console.error(`[${LABEL}] x tsc could not be run: ${error.message}`);
      console.error(
        "  Refusing to report: a gate that cannot invoke its tool has checked nothing.",
      );
      process.exit(2);
    }
    return `${error.stdout ?? ""}${error.stderr ?? ""}`
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /error TS\d+/.test(line));
  }
}

const packages = publishedPackages();
let broken = 0;
let unbuilt = 0;
let checkedEntries = 0;
/** When the most recently written declaration was written — the build this gate is reading. */
let newestDeclarationMs;

for (const pkg of packages) {
  if (!pkg.built) {
    console.error(`[${LABEL}] x ${pkg.name}: no dist/ — run the build before this gate`);
    unbuilt += 1;
    continue;
  }
  checkedEntries += pkg.entries.length;
  for (const entry of pkg.entries) {
    const writtenMs = statSync(entry).mtimeMs;
    if (newestDeclarationMs === undefined || writtenMs > newestDeclarationMs) {
      newestDeclarationMs = writtenMs;
    }
  }
  const diagnostics = diagnosticsFor(pkg.entries);
  if (diagnostics.length === 0) {
    console.log(
      `[${LABEL}] ok ${pkg.name} (${pkg.entries.length} entr${pkg.entries.length === 1 ? "y" : "ies"})`,
    );
    continue;
  }
  broken += 1;
  console.error(`[${LABEL}] x ${pkg.name}: ${diagnostics.length} diagnostic(s)`);
  for (const line of diagnostics.slice(0, MAX_SHOWN)) {
    console.error(`      ${line.replace(`${ROOT}/`, "")}`);
  }
  if (diagnostics.length > MAX_SHOWN) {
    console.error(`      … ${diagnostics.length - MAX_SHOWN} more`);
  }
}

if (broken > 0 || unbuilt > 0) {
  // The two failures are reported apart on purpose: "does not compile" and "was never built" are
  // different facts, and a summary that merges them describes a defect that may not exist.
  const parts = [];
  if (broken > 0) {
    parts.push(
      `${broken} package(s) publish a declaration that does not compile without skipLibCheck`,
    );
  }
  if (unbuilt > 0) parts.push(`${unbuilt} package(s) have no dist/ and were not checked`);
  console.error(`\n[${LABEL}] FAIL — ${parts.join("; ")}.`);
  // A third fact, reported only when it is TRUE. An unrepaired build and a broken declaration
  // produce identical output otherwise, and the message above names the published artifact —
  // which is not what an unrepaired dist is. Stated as an observation about this tree, never as
  // an explanation of the failure: the declarations may also be genuinely broken, and a gate
  // that explains away a real regression is worse than one that is merely unhelpful.
  if (broken > 0 && !repairRanOverBuild(readRepairStamp(ROOT), newestDeclarationMs)) {
    console.error(
      `[${LABEL}] note — tools/repair-dts-imports.mjs has not run over this build. It is the` +
        ` second half of the ROOT script ("build": "pnpm -r run build && node ...), so` +
        ` \`pnpm -r build\` skips it and leaves declarations mid-flight. Re-check with` +
        ` \`pnpm build && pnpm quality:dts-typechecks\` before reading the failure above as a defect.`,
    );
  }
  process.exit(1);
}
console.log(
  `\n[${LABEL}] PASS — ${checkedEntries} published declaration(s) across ${packages.length} package(s) compile without skipLibCheck.`,
);
