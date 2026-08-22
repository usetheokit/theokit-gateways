#!/usr/bin/env node
// Orphaned-docblock gate: a JSDoc block whose next content is ANOTHER JSDoc block.
//
// TypeScript attaches a docblock to the declaration that follows it. When a second block intervenes,
// the first attaches to nothing: the symbol it was written for ships undocumented, and the text
// itself becomes invisible — present in the source, absent from every editor tooltip and from the
// published declaration. `tsc` accepts the shape without a word, which is why it accumulates.
//
// It is an editing accident, not a style choice. Two shapes produce it: a declaration MOVES to
// another module and its docblock is left behind, or a new declaration+docblock is INSERTED between
// an existing docblock and its declaration, stranding the older text.
//
// THE PATTERN'S BODY MUST NOT CONTAIN `*/`. A non-greedy `[\s\S]*?\*\/` backtracks: when the
// lookahead fails right after the first `*/`, the engine extends the body to a LATER `*/` that
// satisfies it, so every docblock matches every later docblock across whole declarations. That
// version, in the repository this gate is ported from, reported 94 sites — all of them the
// instrument rather than the code.
//
// A block at file offset 0 is a module header legitimately preceding the first symbol's docblock and
// is excluded. A header that is NOT at offset 0 still reports, correctly: it is competing for
// attachment, and the fix is to write it as a non-JSDoc comment so it stops competing.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./lib/published-entries.mjs";

const LABEL = "doc-orphans";

/** A JSDoc block, then only whitespace, then another JSDoc block. */
const ORPHAN = /\/\*\*(?:[^*]|\*(?!\/))*\*\/[ \t]*\r?\n\s*(?=\/\*\*)/g;

/** Hand-written TypeScript under `packages/`: no build output, no generated declarations. */
function sources() {
  const packages = join(ROOT, "packages");
  const files = [];
  for (const entry of readdirSync(packages, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
    const path = join(entry.parentPath, entry.name);
    // Any hidden segment is scratch, not source: `.stryker-tmp/sandbox-*` holds a full copy of a
    // package during a mutation run, and reporting a finding twice from a directory that will be
    // deleted is how a gate loses the reader's trust in the findings that are real.
    const parts = relative(packages, path).split("/");
    if (parts.some((part) => part.startsWith(".") || part === "node_modules" || part === "dist")) {
      continue;
    }
    files.push(path);
  }
  return files.sort();
}

const findings = [];
for (const file of sources()) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(ORPHAN)) {
    if (match.index === 0) continue;
    const firstText =
      match[0].split("\n").find((line) => /\*\s*\S/.test(line) && !/^\s*\/\*\*/.test(line)) ?? "";
    findings.push({
      file: relative(ROOT, file),
      line: text.slice(0, match.index).split("\n").length,
      text: firstText.replace(/^\s*\*\s?/, "").slice(0, 96),
    });
  }
}

if (findings.length === 0) {
  console.log(`[${LABEL}] PASS — no docblock is stranded above another docblock.`);
  process.exit(0);
}

console.error(`[${LABEL}] x ${findings.length} orphaned docblock(s):`);
for (const finding of findings) {
  console.error(`      ${finding.file}:${finding.line}  ${finding.text}`);
}
console.error("");
console.error(`[${LABEL}] FAIL — each of these attaches to nothing, so the symbol it was written`);
console.error("  for ships undocumented and the text ships invisible.");
console.error("  Fix by intent, not mechanically: move the block onto the symbol it describes;");
console.error("  delete it when the block below is the newer, correct version; or write it as a");
console.error("  non-JSDoc comment when it is a section or module header.");
process.exit(1);
