#!/usr/bin/env node
/**
 * Every third-party peer range these packages declare, expanded into the majors it claims.
 *
 * WHY THIS EXISTS. A peer range is a promise about an interval, and this repository was keeping
 * exactly one point of each. Measured 2026-08-31 with `@theokit/dep-check@0.9.2 floors`: the
 * dependency gate exercises the floor of every declared range **among the organisation's own
 * packages** and no third-party range at all — eleven findings, all `@theokit/*`. So
 * `@mattermost/client ^9.0.0 || ^11.0.0` was verified at 11.9.0 and never at 9.x,
 * `@slack/bolt ^4.0.0 || ^5.0.0` at 4.x and never at 5.x, `express ^4.18.0 || ^5.0.0` at 5.x and
 * never at 4.x. Two adapters declared a range and no devDependency at all, so what their suite ran
 * against was whatever pnpm's peer auto-install happened to pick.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT. Installing a major and running `typecheck` + `test` +
 * `build` verifies the COMPILE-TIME and PACKAGING contract: a removed export, a changed signature,
 * a type that stopped being assignable. It does not exercise runtime behaviour — the live contracts
 * under `integration/` do that, and they run at one version. Saying so here is the point: a green
 * matrix means the code still compiles and packages against that major, not that the platform still
 * answers the same way.
 *
 * WHY NOT EXTEND `@theokit/dep-check`. That tool is the organisation's, pinned and shared by ten
 * repositories; its scope is sibling packages by design. Forking it to reach third-party ranges
 * would put a local change behind an org-wide pin. This stays here, where the ranges are declared.
 *
 * Usage:
 *   node scripts/peer-majors.mjs            human-readable table
 *   node scripts/peer-majors.mjs --matrix   JSON for a GitHub Actions matrix
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGES = join(ROOT, "packages");

/**
 * The majors a range claims, in the order it claims them.
 *
 * Three outcomes, kept apart because they mean different things:
 *
 *   ENUMERABLE — `^X.Y.Z` alternatives joined by `||`. Every major is a point to verify.
 *   UNBOUNDED  — a range with no ceiling, like `>=7.0.0-rc14`. It claims every major from its
 *                floor to whatever ships next, which cannot be enumerated. Reported and left out
 *                of the matrix; NOT an error, because the declaration is deliberate.
 *   UNPARSED   — anything else. An error, because a range that quietly vanishes from the matrix is
 *                a promise that stopped being checked without anyone deciding to stop checking it.
 */
function majorsOf(range) {
  if (/^(>=|>|\*|x)/.test(range.trim())) return { majors: null, unbounded: true, unparsed: null };
  const parts = range.split("||").map((p) => p.trim());
  const majors = [];
  for (const part of parts) {
    const match = /^\^(\d+)\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.exec(part);
    if (match === null) return { majors: null, unbounded: false, unparsed: part };
    majors.push(match[1]);
  }
  return { majors, unbounded: false, unparsed: null };
}

function publishablePackages() {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(PACKAGES, e.name, "package.json"))
    .map((path) => {
      try {
        return { path, manifest: JSON.parse(readFileSync(path, "utf8")) };
      } catch {
        return null;
      }
    })
    .filter((p) => p !== null && p.manifest.private !== true);
}

/** One row per (package, third-party peer, major). Siblings are dep-check's job, not ours. */
export function peerMajorRows() {
  const rows = [];
  const problems = [];
  const unbounded = [];
  for (const { manifest } of publishablePackages()) {
    for (const [dep, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (dep.startsWith("@theokit/")) continue;
      const parsed = majorsOf(range);
      if (parsed.unbounded) {
        unbounded.push({ pkg: manifest.name, dep, range });
        continue;
      }
      if (parsed.majors === null) {
        problems.push({ pkg: manifest.name, dep, range, unparsed: parsed.unparsed });
        continue;
      }
      for (const major of parsed.majors) rows.push({ pkg: manifest.name, dep, range, major });
    }
  }
  return { rows, problems, unbounded };
}

const { rows, problems, unbounded } = peerMajorRows();

if (process.argv.includes("--matrix")) {
  // stdout carries only the JSON a workflow parses; anything else goes to stderr.
  for (const u of unbounded) {
    console.error(`unbounded: ${u.pkg} declares ${u.dep} ${u.range} — no ceiling, so no major to pin`);
  }
  for (const p of problems) {
    console.error(`unparsed range: ${p.pkg} declares ${p.dep} ${p.range} — "${p.unparsed}" is not ^X.Y.Z`);
  }
  console.log(JSON.stringify({ include: rows }));
  process.exit(problems.length > 0 ? 1 : 0);
}

const width = Math.max(...rows.map((r) => r.pkg.length), 10);
for (const row of rows) {
  console.log(`  ${row.pkg.padEnd(width)}  ${row.dep.padEnd(20)}  ${row.range.padEnd(24)}  major ${row.major}`);
}
console.log(`\n  ${rows.length} (package, peer, major) combinations from ${new Set(rows.map((r) => r.pkg)).size} packages`);
for (const u of unbounded) {
  console.log(`  unbounded: ${u.pkg} declares ${u.dep} ${u.range} — no ceiling, so no major to pin`);
}
for (const p of problems) {
  console.error(`\n  unparsed: ${p.pkg} declares ${p.dep} ${p.range} — "${p.unparsed}" is not ^X.Y.Z`);
}
process.exit(problems.length > 0 ? 1 : 0);
