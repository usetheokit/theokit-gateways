#!/usr/bin/env node
// Declaration-vs-runtime export parity gate.
//
// WHAT THIS IS NOT FOR, established by testing the premise it was started on. The first draft
// opened by claiming it closes the `stripInternal` hole: `@internal` in any leading comment range
// deletes a declaration outright, the runtime keeps the export, and nothing else here would notice.
// Measured 2026-08-20 by doing it — `@internal` on `chunkByGrapheme`, a symbol the barrel exports —
// and the result was not a silent deletion. Every barrel in this repository names its exports
// explicitly (`export { X } from "./m.js"`, no `export *` anywhere), so the barrel re-exports a name
// that no longer exists and the build FAILS outright. Loud, immediate, impossible to miss. That
// justification is false here and is recorded rather than quietly dropped, because the day someone
// writes `export *` it becomes true again and this note is what says so.
//
// WHAT IT IS FOR: the other direction, which no gate here can see and nothing makes loud.
//
//   declared, absent from the runtime -> it compiles, and it is `undefined` when the program runs
//
// That is the worst failure shape in this set: it walks past every static gate into a consumer's
// production, where the only symptom is a call on undefined. It needs no `@internal` and no
// `export *` to occur — only the two emit pipelines disagreeing, which this toolchain has already
// been measured doing. #29 was tsup's declaration rollup emitting a `.d.ts` that disagreed with its
// own source, in five of eleven packages. A `.d.ts` that disagrees with its `.js` is the same class
// of divergence from the same tool.
//
// A TYPE IS NOT A VALUE, and that distinction is the whole check. Comparing raw export lists reports
// every interface and type alias as "missing at runtime" — measured while building this: 78
// findings, all of them the instrument. Only value exports exist in both files and can be compared.
//
// The two directions are reported apart because they are different defects with different fixes.
//
// Installed at a clean baseline (0 divergences across 11 packages), which is the right moment for a
// ratchet: it has nothing to forgive and nothing to allowlist.

import { existsSync } from "node:fs";
import { relative } from "node:path";
import { publishedPackages, ROOT } from "./lib/published-entries.mjs";
import { compareExports, valueExportsOf } from "./lib/value-exports.mjs";

const LABEL = "dts-parity";

const packages = publishedPackages();
let broken = 0;
let unreadable = 0;
let comparedPackages = 0;

for (const pkg of packages) {
  if (!pkg.built) {
    console.error(`[${LABEL}] x ${pkg.name}: publishes no declaration — run the build`);
    unreadable += 1;
    continue;
  }

  for (const entry of pkg.rows.filter((row) => row.decl.endsWith(".d.ts"))) {
    const runtimePath = entry.decl.replace(/\.d\.ts$/, ".js");
    if (!existsSync(runtimePath)) {
      // Declared types with no runtime beside them is itself the second defect, at file scale.
      console.error(
        `[${LABEL}] x ${entry.specifier}: ${relative(ROOT, entry.decl)} has no ${relative(ROOT, runtimePath)}`,
      );
      broken += 1;
      continue;
    }

    const types = valueExportsOf(entry.decl, false);
    const runtime = valueExportsOf(runtimePath, true);
    if (types === undefined || runtime === undefined) {
      // Refusing to report is the point: an unreadable file produces an empty set, and an empty set
      // compared against another empty set is a green run that measured nothing.
      console.error(`[${LABEL}] x ${entry.specifier}: the compiler could not read one of the pair`);
      unreadable += 1;
      continue;
    }

    comparedPackages += 1;
    const { missingTypes, missingRuntime } = compareExports(types, runtime);
    if (missingTypes.length === 0 && missingRuntime.length === 0) continue;

    broken += 1;
    console.error(`[${LABEL}] x ${entry.specifier}`);
    if (missingTypes.length > 0) {
      console.error(
        `      exported by the runtime, absent from the declaration: ${missingTypes.join(", ")}`,
      );
      console.error("        A consumer cannot import these in TypeScript. Most often `@internal`");
      console.error("        in a leading comment, which deletes the declaration outright.");
    }
    if (missingRuntime.length > 0) {
      console.error(`      declared, absent from the runtime: ${missingRuntime.join(", ")}`);
      console.error("        These compile and are `undefined` when the program runs.");
    }
  }
}

if (unreadable > 0 || broken > 0) {
  const parts = [];
  if (broken > 0)
    parts.push(`${broken} entr${broken === 1 ? "y" : "ies"} disagree with their runtime`);
  if (unreadable > 0) parts.push(`${unreadable} could not be read and were NOT compared`);
  console.error(`\n[${LABEL}] FAIL — ${parts.join("; ")}.`);
  process.exit(broken > 0 ? 1 : 2);
}

console.log(
  `[${LABEL}] PASS — ${comparedPackages} published entr${comparedPackages === 1 ? "y" : "ies"} export exactly the values their runtime does.`,
);
