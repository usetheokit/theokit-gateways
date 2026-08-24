#!/usr/bin/env node
// Every decision id a published declaration cites must be accounted for — raised by B-015.
//
// Measured: 76 distinct `D###` ids across the eleven published `.d.ts`, and 59 resolved nowhere in
// this repository. They were written in implementation plans under `.claude/`, which is development
// tooling and is not versioned, so the citations reached npm while the documents defining them
// stayed on one machine.
//
// This does not require a decision to EXIST — `docs/adr/decision-ids.md` records the lost ones as
// lost, and a lost row satisfies this gate. What it requires is that no NEW unaccounted citation
// enters a published declaration, which is what stops the list growing while nobody is looking.

import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { unregisteredCitations } from "./lib/adr-citations.mjs";
import { publishedPackages } from "./lib/published-entries.mjs";

const LABEL = "adr-citations";
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REGISTRY = join("docs", "adr", "decision-ids.md");

/**
 * The most **lost** rows this repository tolerates.
 *
 * Set to the count on the day the registry was written. It may only go down: the check above is
 * satisfied by adding a lost row, so without a ceiling the cheapest way past this gate is to
 * declare a new debt, and the file's claim that "a lost row is a debt, not a resting state" would
 * be prose nothing enforces.
 */
const LOST_CEILING = 59;

/**
 * Every published declaration, and every one that is missing.
 *
 * Both, because reporting only on what exists let a partial build PASS over a subset: removing one
 * package's `dist` printed "every D-id in 10 published declaration(s) has a row" and exited 0,
 * while that package carried ten of the lost ids. A green line naming a smaller number is not a
 * signal anyone reads.
 */
function declarations() {
  const found = new Map();
  const missing = [];
  for (const { dir } of publishedPackages(ROOT)) {
    const rel = join("packages", basename(dir), "dist", "index.d.ts");
    try {
      found.set(rel, readFileSync(join(ROOT, rel), "utf8"));
    } catch {
      missing.push(rel);
    }
  }
  return { found, missing };
}

function main() {
  let registry;
  try {
    registry = readFileSync(join(ROOT, REGISTRY), "utf8");
  } catch {
    console.error(
      `[${LABEL}] x ${REGISTRY} is missing — every citation would read as unaccounted.`,
    );
    process.exit(2);
  }

  const { found: files, missing: unbuilt } = declarations();
  if (unbuilt.length > 0) {
    console.error(`[${LABEL}] x ${unbuilt.length} package(s) have no built declaration:`);
    for (const rel of unbuilt) console.error(`    ${rel}`);
    console.error(
      "\n  Refusing to report: a PASS over a subset reads as a PASS over everything, and the" +
        " packages that are missing are exactly the ones nobody looked at. Run `pnpm build`.",
    );
    process.exit(2);
  }

  const missing = unregisteredCitations(files, registry);
  if (missing.length > 0) {
    console.error(`[${LABEL}] x ${missing.length} citation(s) with no row in ${REGISTRY}:`);
    for (const { id, file } of missing) console.error(`    ${id}  cited by ${file}`);
    console.error(
      `\n[${LABEL}] FAIL — a reader who follows one of these finds nothing. Add a row: the` +
        " decision if you have it, or status **lost** if its origin is gone.",
    );
    process.exit(1);
  }

  // The ratchet. A **lost** row satisfies the check above, which is deliberate — a decision whose
  // origin is gone cannot be invented. But it also makes "add a lost row" the cheapest way past
  // this gate, so the count may never rise: clearing a debt is the only way to take one on.
  const lost = (registry.match(/^\|\s*`D\d{3}`\s*\|\s*\*\*lost\*\*/gm) ?? []).length;
  if (lost > LOST_CEILING) {
    console.error(`[${LABEL}] x ${lost} ids are recorded lost; the ceiling is ${LOST_CEILING}.`);
    console.error(
      "\n  A lost row is a debt, not a resting state. Recover the decision and record it, or" +
        " remove the citation from the docblock that carries it. Lower the ceiling when you do.",
    );
    process.exit(1);
  }

  console.log(
    `[${LABEL}] PASS — every D-id in ${files.size} published declaration(s) has a row,` +
      ` ${lost} of them lost (ceiling ${LOST_CEILING}). Accounted for is not recoverable.`,
  );
}

main();
