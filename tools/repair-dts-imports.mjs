#!/usr/bin/env node
// Post-build repair for the DTS rollup's unresolved-reference defect — #29.
//
// tsup/rollup-plugin-dts emits declarations that name a type it never bound in the same file. Our
// source is correct (`pnpm -r run typecheck` is green on all eleven) and tsup 8.5.x is `latest`, so
// there is nothing to upgrade to and nothing to fix in the source — measured 2026-08-20, and a
// source-level experiment on `gateway-email` (importing the type before re-exporting it, instead of
// `export type { ... } from`) changed the emitted output not at all.
//
// Three shapes, all measured in this repo:
//
//   RE-EXPORT WITHOUT IMPORT — `gateway-email`, `gateway-teams`
//     line 1:   import { BasePlatformAdapter, ... } from '@theokit/gateway';  <- no EmailMessageEvent
//     line 2:   export { EmailMessageEvent } from '@theokit/gateway';
//     line 116:   ): Promise<EmailMessageEvent>;                              <- unbound
//     An `export ... from` clause re-exports; it does not declare the name locally.
//
//   TYPE-ONLY IMPORT DROPPED — `gateway-slack`, `gateway-sms`, `gateway-whatsapp`
//     The rollup inlines a declaration that uses a type from an external module and drops the import
//     that carried it. `GatewayConfigurationError` (from `@theokit/gateway`) and `ChildProcess` (from
//     `node:child_process`) appear in no import line at all.
//
//   LOCAL ALIAS APPLIED TO THE EXPORT BUT NOT TO A USE — `gateway-whatsapp`
//     line 55:  interface WhatsAppSendResult$1 { ... }
//     line 410: type ErrorPayload = Required<WhatsAppSendResult>["error"];    <- unbound
//     line 432: export { ..., type WhatsAppSendResult$1 as WhatsAppSendResult, ... };
//     The declaration was renamed to avoid a collision and one use site was not.
//
// WHAT KEEPS IT HONEST. The repair never invents a name:
//
//   1. it acts only on a name the COMPILER reported unresolved, at the position the compiler gave;
//   2. it binds that name only to a module the COMPILER confirms exports it, asked by compiling a
//      one-line probe from inside the package — so a name is never attributed to a module by guess;
//   3. when it takes a module specifier from our own `src/`, it is copying the import our source
//      already wrote, not inferring where the type might live;
//   4. it re-runs the compiler afterwards and FAILS if the diagnostics did not reach zero, rather
//      than reporting a repair it did not achieve.
//
// When the upstream defect is fixed, step 1 finds nothing and this becomes a no-op. It cannot mask a
// regression it is not triggered by.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { sweepStaleProbes, withProbe } from "./lib/dts-probe.mjs";
import { publishedPackages, ROOT } from "./lib/published-entries.mjs";
import { writeRepairStamp } from "./lib/repair-stamp.mjs";

const LABEL = "dts-repair";
const ts = createRequire(import.meta.url)("typescript");

/**
 * The names a declaration file exports, asked of the compiler.
 *
 * S0 rewrites `export ... from` statements, which is the one strategy here that can change what a
 * consumer is able to import. A repair that fixes a typecheck by quietly dropping an export has
 * broken the package in a way the typecheck cannot see, so the surface is captured before and
 * compared after, per file, and a difference fails the run.
 */
function exportedNames(declPath) {
  const program = ts.createProgram([declPath], {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const source = program.getSourceFile(declPath);
  if (source === undefined) return undefined;
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(source);
  if (symbol === undefined) return undefined;
  return new Set(checker.getExportsOfModule(symbol).map((exported) => exported.getName()));
}

/** `path/to/file.d.ts(410,30): error TS2552: Cannot find name 'WhatsAppSendResult'.` */
const DIAGNOSTIC = /^(.+?\.d\.[cm]?ts)\((\d+),(\d+)\): error TS\d+: Cannot find name '([^']+)'/;

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The compiler could not be RUN — distinct from the compiler reporting diagnostics. */
class TscUnavailableError extends Error {
  name = "TscUnavailableError";
}

function tsc(args, cwd) {
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
        ...args,
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return [];
  } catch (error) {
    // A failed invocation is not a clean compile — the same guard as check-dts-typechecks.mjs. A
    // spawn that never ran arrives here with a null status and no stdout, and returning [] for that
    // would let a repair report success having compiled nothing.
    //
    // It throws rather than calling `process.exit` because this runs INSIDE a probe's lifetime, and
    // `process.exit` does not unwind the stack: the `finally` that deletes the probe never ran, so
    // the file outlived the process that made it (#40). Throwing lets every cleanup on the way out
    // run before `main`'s handler turns it into the same exit code.
    if (typeof error.status !== "number") {
      throw new TscUnavailableError(error.message);
    }
    return `${error.stdout ?? ""}${error.stderr ?? ""}`.split("\n").map((line) => line.trim());
  }
}

/**
 * Does `specifier` export `name`, resolved from `pkgDir`? Asked of the compiler by compiling a
 * one-line probe, which answers identically for a workspace package, a published dependency and a
 * Node builtin — and cannot be fooled by the name appearing in a JSDoc paragraph, which a regex over
 * the module's declaration can.
 */
const declaresCache = new Map();
function moduleDeclares(specifier, name, pkgDir) {
  const key = `${pkgDir}|${specifier}|${name}`;
  const hit = declaresCache.get(key);
  if (hit !== undefined) return hit;
  const diagnostics = withProbe(
    pkgDir,
    declaresCache.size,
    `import type { ${name} } from ${JSON.stringify(specifier)};\nexport type _Probe = ${name};\n`,
    (probe) => tsc([probe], pkgDir).filter((line) => /error TS\d+/.test(line)),
  );
  const answer = diagnostics.length === 0;
  declaresCache.set(key, answer);
  return answer;
}

/**
 * Every non-relative `from "..."` specifier our own source binds `name` from. The source is where a
 * type's origin is STATED, so copying it is not inference — and every candidate it yields still has
 * to pass `moduleDeclares` before anything is written.
 */
function specifiersBindingInSource(pkgDir, name) {
  const src = join(pkgDir, "src");
  if (!existsSync(src)) return [];
  const bound = new RegExp(
    String.raw`\{[^}]*\b(?:type\s+)?${escapeRegExp(name)}\b[^}]*\}\s*from\s*["']([^"']+)["']`,
    "g",
  );
  const found = new Set();
  for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    for (const match of readFileSync(join(entry.parentPath, entry.name), "utf8").matchAll(bound)) {
      if (!match[1].startsWith(".")) found.add(match[1]);
    }
  }
  return [...found];
}

/**
 * S0 — the name is RE-EXPORTED from module `M` by an `export ... from` clause while local
 * declarations use it bare. Binding it as an extra import beside the untouched re-export makes the
 * name a duplicate identifier (measured on `gateway-email`: four TS2300s), so the clause is
 * converted rather than added to:
 *
 *   import { BasePlatformAdapter, ... } from '@theokit/gateway';
 *   export { EmailMessageEvent } from '@theokit/gateway';
 *     becomes
 *   import { EmailMessageEvent, BasePlatformAdapter, ... } from '@theokit/gateway';
 *   export type { EmailMessageEvent };
 *
 * The name stays exported, so the package's public surface is unchanged — this moves where the name
 * is bound, never whether a consumer can reach it.
 */
/** Adds `name` to the file's `import ... from M` clause, or creates one when there is none. */
function withImportedName(source, name, specifier, quote) {
  const importClause = new RegExp(
    String.raw`import\s*\{([^}]*?)\}\s*from\s*(['"])${escapeRegExp(specifier)}\2`,
  );
  const existing = importClause.exec(source);
  if (existing === null) {
    return `import type { ${name} } from ${quote}${specifier}${quote};\n${source}`;
  }
  return source.replace(
    existing[0],
    `import { ${name},${existing[1]}} from ${existing[2]}${specifier}${existing[2]}`,
  );
}

/** The same clause with `name` dropped, rendered back as a statement — empty when nothing remains. */
function reExportWithout(specifiers, name, specifier, quote) {
  const remaining = specifiers
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.replace(/^type\s+/, "") !== name);
  if (remaining.length === 0) return "";
  return `export { ${remaining.join(", ")} } from ${quote}${specifier}${quote};\n`;
}

const RE_EXPORT_CLAUSE = /export\s*\{([^}]*?)\}\s*from\s*(['"])([^.'"][^'"]*)\2\s*;?/g;

function bindViaReExport(source, name, pkgDir) {
  for (const match of source.matchAll(RE_EXPORT_CLAUSE)) {
    const [statement, specifiers, quote, specifier] = match;
    const listed = new RegExp(String.raw`(?:^|,)\s*(?:type\s+)?${escapeRegExp(name)}\s*(?:,|$)`);
    if (!listed.test(specifiers)) continue;
    if (!moduleDeclares(specifier, name, pkgDir)) continue;

    const kept = reExportWithout(specifiers, name, specifier, quote);
    const converted = source.replace(statement, `${kept}export type { ${name} };`);
    return withImportedName(converted, name, specifier, quote);
  }
  return undefined;
}

/** S1 — the name is exported by a module the file ALREADY imports: add it to that clause. */
function bindViaExistingImport(source, name, pkgDir) {
  const importClause = /import\s*\{([^}]*?)\}\s*from\s*(['"])([^.'"][^'"]*)\2/g;
  for (const match of source.matchAll(importClause)) {
    const [, specifiers, quote, specifier] = match;
    const already = new RegExp(
      String.raw`(?:^|,)\s*(?:\w+\s+as\s+)?${escapeRegExp(name)}\s*(?:,|$)`,
    );
    if (already.test(specifiers)) return undefined; // already bound — not this defect
    if (!moduleDeclares(specifier, name, pkgDir)) continue;
    return source.replace(
      match[0],
      `import { ${name},${specifiers}} from ${quote}${specifier}${quote}`,
    );
  }
  return undefined;
}

/** S2 — our own source imports the name from a module the file does NOT reference: prepend it. */
function bindViaSourceImport(source, name, pkgDir) {
  // Defence in depth against the duplicate-identifier failure the per-name grouping already
  // prevents: prepending a binding for a name the file imports anywhere is never right.
  const anyImport = new RegExp(
    String.raw`import\s*(?:type\s*)?\{[^}]*(?:^|[{,\s])(?:type\s+)?${escapeRegExp(name)}\s*(?:,|\}|\s)`,
  );
  if (anyImport.test(source)) return undefined;
  for (const specifier of specifiersBindingInSource(pkgDir, name)) {
    if (!moduleDeclares(specifier, name, pkgDir)) continue;
    return `import type { ${name} } from '${specifier}';\n${source}`;
  }
  return undefined;
}

/**
 * S3 — the file declares `name$N` and exports it aliased back to `name`: fix the one use site the
 * rollup failed to rename. Applied at the exact position the compiler reported, and only after
 * confirming the character span there really is the name — a rewrite driven by a diagnostic is only
 * as safe as its agreement with the text it edits.
 */
function bindViaLocalAlias(source, name, line, column) {
  const aliasExport = new RegExp(
    String.raw`\b(${escapeRegExp(name)}\$\d+)\s+as\s+${escapeRegExp(name)}\b`,
  );
  const alias = aliasExport.exec(source);
  if (alias === null) return undefined;
  const local = alias[1];
  const declared = new RegExp(
    String.raw`\b(?:interface|type|declare\s+(?:class|function|const))\s+${escapeRegExp(local)}\b`,
  );
  if (!declared.test(source)) return undefined; // the aliased name is not declared here

  const lines = source.split("\n");
  const target = lines[line - 1];
  if (target === undefined) return undefined;
  const at = column - 1;
  if (target.slice(at, at + name.length) !== name) return undefined; // position disagrees; refuse
  lines[line - 1] = target.slice(0, at) + local + target.slice(at + name.length);
  return lines.join("\n");
}

function countSites(byFile) {
  let total = 0;
  for (const sites of byFile.values()) total += sites.length;
  return total;
}

/** Current unresolved-name diagnostics for `pkg`, grouped by the declaration file reporting them. */
function diagnosticSites(pkg) {
  const byFile = new Map();
  for (const raw of tsc(["--skipLibCheck", "false", ...pkg.entries], ROOT)) {
    const match = DIAGNOSTIC.exec(raw);
    if (match === null) continue;
    const [, file, line, column, name] = match;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ name, line: Number(line), column: Number(column) });
  }
  return byFile;
}

/**
 * Refuse a repair that changed what the file exports.
 *
 * S0 rewrites `export ... from` statements, the one strategy here that can change what a consumer
 * is able to import. A repair that fixes a typecheck by quietly dropping an export has broken the
 * package in a way the typecheck cannot see.
 */
function assertSurfaceUnchanged(pkgName, file, before, after) {
  if (before === undefined || after === undefined) return;
  const lost = [...before].filter((name) => !after.has(name));
  const gained = [...after].filter((name) => !before.has(name));
  if (lost.length === 0 && gained.length === 0) return;
  console.error(`[${LABEL}] x ${pkgName}: the repair changed the public surface of ${file}`);
  if (lost.length > 0) console.error(`      lost: ${lost.join(", ")}`);
  if (gained.length > 0) console.error(`      gained: ${gained.join(", ")}`);
  process.exit(1);
}

/**
 * Bind every reported name in one declaration file, write it back, and verify the export surface
 * survived. Returns how many names were bound.
 */
function repairFile(pkg, file, sites) {
  const path = file.startsWith("/") ? file : join(ROOT, file);
  const surfaceBefore = exportedNames(path);
  let source = readFileSync(path, "utf8");

  // Grouped by NAME: S0-S2 bind a name once for the whole file, and applying them per diagnostic
  // bound `EmailMessageEvent` twice — a converted re-export plus a prepended import — whose
  // duplicate identifier failed the very typecheck the repair exists to pass.
  const names = new Map();
  for (const site of sites) if (!names.has(site.name)) names.set(site.name, site);

  let bound = 0;
  for (const [name, site] of names) {
    const next =
      bindViaReExport(source, name, pkg.dir) ??
      bindViaExistingImport(source, name, pkg.dir) ??
      bindViaSourceImport(source, name, pkg.dir) ??
      bindViaLocalAlias(source, name, site.line, site.column);
    if (next === undefined) continue;
    source = next;
    bound += 1;
  }
  writeFileSync(path, source);
  assertSurfaceUnchanged(pkg.name, file, surfaceBefore, exportedNames(path));
  return bound;
}

/** Name every site no strategy could bind. Returns how many, so the run can fail on the total. */
function reportUnbindable(pkgName, byFile) {
  let count = 0;
  for (const [file, sites] of byFile) {
    for (const site of sites) {
      console.error(`[${LABEL}] x ${pkgName}: cannot bind '${site.name}' (${file}:${site.line})`);
      count += 1;
    }
  }
  return count;
}

const MAX_ROUNDS = 6;

/** One pass over the current diagnostics. Returns what it bound, and what it could not. */
function repairRound(pkg, byFile) {
  let bound = 0;
  for (const [file, sites] of byFile) bound += repairFile(pkg, file, sites);
  // A round that bound nothing will bind nothing next time either — the input is identical. Naming
  // the stuck sites here is what turns "still failing" into "cannot bind X at file:line".
  return bound > 0
    ? { bound, unresolved: 0 }
    : { bound, unresolved: reportUnbindable(pkg.name, byFile) };
}

/**
 * Bind names until the compiler stops reporting them, re-asking between rounds.
 *
 * S0/S2 insert lines, which shifts every position recorded earlier in the same pass — measured
 * here: binding `ChildProcess` moved `WhatsAppSendResult` from line 410 to 411, and S3's position
 * guard then correctly refused to edit text that no longer said what the diagnostic claimed. Acting
 * only on CURRENT diagnostics removes the class of bug rather than ordering around one instance.
 *
 * `found` is the site count of the FIRST round — what the package arrived with, which is what the
 * summary line reports.
 */
function runRepairRounds(pkg) {
  let repaired = 0;
  let unresolved = 0;
  let found = 0;
  let round = 0;

  for (; round < MAX_ROUNDS; round += 1) {
    const byFile = diagnosticSites(pkg);
    if (byFile.size === 0) break;
    if (round === 0) found = countSites(byFile);

    const outcome = repairRound(pkg, byFile);
    repaired += outcome.bound;
    if (outcome.bound === 0) {
      unresolved += outcome.unresolved;
      break;
    }
  }

  if (round === MAX_ROUNDS) {
    console.error(
      `[${LABEL}] x ${pkg.name}: still repairing after ${MAX_ROUNDS} rounds — refusing to loop`,
    );
    process.exit(1);
  }
  return { repaired, unresolved, found };
}

/**
 * Re-run the compiler over the repaired declarations and refuse to report a repair that did not
 * actually reach zero diagnostics.
 */
function assertDeclarationsCompile(pkg) {
  const after = tsc(["--skipLibCheck", "false", ...pkg.entries], ROOT).filter((line) =>
    /error TS\d+/.test(line),
  );
  if (after.length === 0) return;
  console.error(`[${LABEL}] x ${pkg.name}: ${after.length} diagnostic(s) remain after repair`);
  for (const line of after.slice(0, 12)) console.error(`      ${line.replace(`${ROOT}/`, "")}`);
  process.exit(1);
}

/**
 * Repair one package's declarations. Returns `{ repaired, unresolved }`; exits the process on a
 * failure no further round can recover from.
 */
function repairPackage(pkg) {
  if (!pkg.built) {
    console.error(`[${LABEL}] x ${pkg.name}: no dist/ — run the build first`);
    process.exit(2);
  }

  // Clear scratch a killed run could not: a signal leaves no `finally` to run, and the leftover is
  // a `.ts` file sitting in a published package's directory (#40).
  const stale = sweepStaleProbes(pkg.dir);
  if (stale > 0) {
    console.warn(`[${LABEL}] ! ${pkg.name}: removed ${stale} stale probe(s) from an earlier run`);
  }

  const { repaired, unresolved, found } = runRepairRounds(pkg);
  if (found === 0) {
    console.log(`[${LABEL}] ok ${pkg.name} — nothing to repair`);
    return { repaired, unresolved };
  }
  assertDeclarationsCompile(pkg);
  console.log(`[${LABEL}] ok ${pkg.name} — bound ${found} name(s); declarations compile`);
  return { repaired, unresolved };
}

/**
 * Repair every matched package, or report why it could not.
 *
 * The body lives in a function so the process exits from ONE place. A helper that called
 * `process.exit` from inside a probe's lifetime skipped the cleanup on the way out, which is how a
 * scratch file ended up untracked in a published package's directory (#40).
 */
function main() {
  const only = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
  const packages = publishedPackages().filter((pkg) => only === undefined || pkg.dir === only);
  if (packages.length === 0) {
    console.error(
      `[${LABEL}] x no package matched ${only ?? "(all)"} — refusing to report success`,
    );
    process.exit(2);
  }

  let repaired = 0;
  let unresolved = 0;
  for (const pkg of packages) {
    const result = repairPackage(pkg);
    repaired += result.repaired;
    unresolved += result.unresolved;
  }

  if (unresolved > 0) {
    console.error(`[${LABEL}] FAIL — ${unresolved} name(s) could not be bound`);
    process.exit(1);
  }
  // Record that the repair ran over this build. `check-dts-typechecks.mjs` reads it to tell an
  // UNREPAIRED declaration from a broken one — the two are indistinguishable in the output
  // otherwise, and reporting the first as the second names the published artifact for a state
  // that is never published. Only on the success path: a failed repair has not run over anything.
  //
  // Stamped only for a full run. A `--only` pass repairs one package and leaves the rest as they
  // were, so claiming the build is repaired would be false for every package it skipped.
  if (only === undefined) writeRepairStamp(ROOT);
  console.log(
    `[${LABEL}] done — ${repaired} binding(s) added across ${packages.length} package(s)`,
  );
}

try {
  main();
} catch (error) {
  if (error instanceof TscUnavailableError) {
    console.error(`[${LABEL}] x tsc could not be run: ${error.message}`);
    process.exit(2);
  }
  throw error;
}
