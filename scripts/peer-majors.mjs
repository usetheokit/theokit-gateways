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
import { readdirSync, readFileSync } from "node:fs";
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
  const floor = /^(?:>=|>)\s*(\d+)\./.exec(range.trim());
  if (floor !== null)
    return { majors: null, unbounded: true, floorMajor: floor[1], unparsed: null };
  // `*` or `x` names no floor at all, so there is nothing to resolve from.
  if (/^(\*|x)/.test(range.trim()))
    return { majors: null, unbounded: true, floorMajor: null, unparsed: null };
  const parts = range.split("||").map((p) => p.trim());
  const majors = [];
  for (const part of parts) {
    const match = /^\^(\d+)\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.exec(part);
    if (match === null) return { majors: null, unbounded: false, unparsed: part };
    majors.push(match[1]);
  }
  return { majors, unbounded: false, unparsed: null };
}

/**
 * The majors a registry actually serves at or above an unbounded floor.
 *
 * WHY THIS ASKS THE REGISTRY. An unbounded range like `>=7.0.0-rc14` claims every major from its
 * floor upward, including ones that do not exist yet — so it cannot be enumerated from the manifest
 * alone. The first version of this script stopped there and reported it as "no ceiling, so no major
 * to pin", which is true and useless: the day the dependency publishes a new major, the claim goes
 * untested and nothing here notices. That is the same shape as the defect this whole workflow was
 * built to catch, one file over.
 *
 * Found by a peer applying this method to their own repository and asking the question this script
 * did not: are there majors published ABOVE the floor that nobody exercises?
 *
 * A registry that cannot be reached does NOT silently drop the range — the caller keeps it in the
 * unbounded list with the reason, because "we could not check" and "there is nothing to check" are
 * different facts.
 */
/** Majors a version could not be resolved for — reported, never silently dropped. */
const unresolvable = [];

/** One registry answer per dependency, fetched once up front. */
const versionCache = new Map();

/**
 * Ask the npm registry directly over HTTPS.
 *
 * `fetch` rather than shelling out to `npm view`. Sonar flagged the subprocess correctly — invoking
 * a binary by NAME resolves it through `PATH`, so anything that can write a directory on `PATH`
 * chooses what runs. The registry is an HTTP API and Node has had a global `fetch` since 18, so the
 * subprocess bought nothing and cost a command-injection surface, a dependency on npm being
 * installed, and a process spawn per dependency.
 *
 * A dependency that cannot be reached is recorded WITH ITS REASON and never silently dropped:
 * "we could not check" and "there is nothing to check" are different facts.
 */
async function loadVersions(dep) {
  // Scoped names carry a slash the registry expects percent-encoded.
  const url = `https://registry.npmjs.org/${dep.replace("/", "%2F")}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/vnd.npm.install-v1+json" } });
    if (!res.ok)
      return { versions: null, reason: `the registry answered ${res.status} for ${dep}` };
    const body = await res.json();
    const versions = Object.keys(body.versions ?? {});
    if (versions.length === 0)
      return { versions: null, reason: `the registry lists no versions for ${dep}` };
    return { versions, reason: null };
  } catch (err) {
    // Carries the real message. An earlier version said only "the registry did not answer", and
    // when a missing import made the call throw, the report blamed the registry for a bug in this
    // file — a generic message that misattributes is worse than none.
    return {
      versions: null,
      reason: `could not reach the registry for ${dep}: ${err.message.split("\n")[0]}`,
    };
  }
}

/** Reads what `loadVersions` already put in the cache. Classification stays synchronous. */
function publishedVersions(dep) {
  return versionCache.get(dep) ?? { versions: null, reason: `${dep} was never fetched` };
}

/**
 * The version to actually install for one major: the highest published in it, stable preferred.
 *
 * A major is not a version, and `^7` is not a way to ask for one. Semver excludes prereleases from
 * a caret range, so `^7` matches NOTHING when the only published 7.x is `7.0.0-rc14` — which is
 * exactly the case `baileys >=7.0.0-rc14` presents, and exactly how this was found: the first
 * version of the checker built `^${major}` and the install resolved to nothing.
 *
 * Resolving here rather than in the checker also means the matrix row names the version that was
 * verified. "major 9" in a report is a claim about an interval; `9.9.0` is a fact.
 */
function versionForMajor(versions, major) {
  const inMajor = versions.filter((v) => String(v).split(".")[0] === String(major));
  if (inMajor.length === 0) return null;
  const stable = inMajor.filter((v) => !String(v).includes("-"));
  const pool = stable.length > 0 ? stable : inMajor;
  return pool[pool.length - 1];
}

function publishedMajorsAtOrAbove(dep, floorMajor) {
  const { versions, reason } = publishedVersions(dep);
  if (versions === null) return { majors: null, reason };
  const majors = [...new Set(versions.map((v) => String(v).split(".")[0]))]
    .filter((m) => /^\d+$/.test(m) && Number(m) >= Number(floorMajor))
    .sort((a, b) => Number(a) - Number(b));
  return { majors, reason: null };
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

/**
 * Classify one peer declaration into the bucket it belongs in.
 *
 * Split out of `peerMajorRows` so each function answers one question: this one decides WHAT a
 * declaration is, the caller decides where to put it.
 */
function classify(pkgName, dep, range) {
  const parsed = majorsOf(range);
  if (parsed.unbounded) {
    if (parsed.floorMajor === null) {
      return {
        kind: "unbounded",
        entry: { pkg: pkgName, dep, range, reason: "the range names no floor" },
      };
    }
    const { majors, reason } = publishedMajorsAtOrAbove(dep, parsed.floorMajor);
    if (majors === null) return { kind: "unbounded", entry: { pkg: pkgName, dep, range, reason } };
    return { kind: "rows", entry: rowsFor(pkgName, dep, range, majors) };
  }
  if (parsed.majors === null) {
    return { kind: "problem", entry: { pkg: pkgName, dep, range, unparsed: parsed.unparsed } };
  }
  return { kind: "rows", entry: rowsFor(pkgName, dep, range, parsed.majors) };
}

/**
 * One row per major, each naming the version that will actually be installed.
 *
 * A major with nothing published in it is dropped with a note rather than emitted: a matrix job
 * that installs a version the registry does not serve fails for a reason that has nothing to do
 * with the code under test.
 */
function rowsFor(pkgName, dep, range, majors) {
  const { versions, reason } = publishedVersions(dep);
  if (versions === null) {
    unresolvable.push({ pkg: pkgName, dep, range, reason });
    return [];
  }
  const rows = [];
  for (const major of majors) {
    const version = versionForMajor(versions, major);
    if (version === null) {
      unresolvable.push({
        pkg: pkgName,
        dep,
        range,
        reason: `nothing published in major ${major}`,
      });
      continue;
    }
    rows.push({ pkg: pkgName, dep, range, major, version });
  }
  return rows;
}

/** Every third-party peer declaration across the workspace, as `[pkgName, dep, range]`. */
function thirdPartyDeclarations() {
  return publishablePackages().flatMap(({ manifest }) =>
    Object.entries(manifest.peerDependencies ?? {})
      // Siblings are dep-check's job — its floor leg already covers them, and duplicating that
      // here would put one claim behind two gates that can disagree.
      .filter(([dep]) => !dep.startsWith("@theokit/"))
      .map(([dep, range]) => [manifest.name, dep, range]),
  );
}

/** One row per (package, third-party peer, major), plus what could not be turned into rows. */
export function peerMajorRows() {
  const rows = [];
  const problems = [];
  const unbounded = [];
  const bucket = { rows, problem: problems, unbounded };
  for (const [pkgName, dep, range] of thirdPartyDeclarations()) {
    const { kind, entry } = classify(pkgName, dep, range);
    if (kind === "rows") rows.push(...entry);
    else bucket[kind].push(entry);
  }
  return { rows, problems, unbounded };
}

// Fetch every third-party dependency's version list ONCE, in parallel, before classifying.
// Prefetching is what lets the classification below stay synchronous and pure: it reads a map
// instead of awaiting inside a loop, and one round of parallel requests replaces a serial spawn
// per dependency.
await Promise.all(
  [...new Set(thirdPartyDeclarations().map(([, dep]) => dep))].map(async (dep) => {
    versionCache.set(dep, await loadVersions(dep));
  }),
);

const { rows, problems, unbounded } = peerMajorRows();

if (process.argv.includes("--matrix")) {
  // stdout carries only the JSON a workflow parses; anything else goes to stderr.
  for (const u of unresolvable) {
    console.error(`unresolved: ${u.pkg} declares ${u.dep} ${u.range} — ${u.reason}`);
  }
  for (const u of unbounded) {
    console.error(`unbounded: ${u.pkg} declares ${u.dep} ${u.range} — not resolved: ${u.reason}`);
  }
  for (const p of problems) {
    console.error(
      `unparsed range: ${p.pkg} declares ${p.dep} ${p.range} — "${p.unparsed}" is not ^X.Y.Z`,
    );
  }
  console.log(JSON.stringify({ include: rows }));
  process.exit(problems.length > 0 ? 1 : 0);
}

const width = Math.max(...rows.map((r) => r.pkg.length), 10);
for (const row of rows) {
  console.log(
    `  ${row.pkg.padEnd(width)}  ${row.dep.padEnd(20)}  ${row.range.padEnd(24)}  ${row.version}`,
  );
}
console.log(
  `\n  ${rows.length} (package, peer, major) combinations from ${new Set(rows.map((r) => r.pkg)).size} packages`,
);
for (const u of unresolvable) {
  console.log(`  unresolved: ${u.pkg} declares ${u.dep} ${u.range} — ${u.reason}`);
}
for (const u of unbounded) {
  console.log(`  unbounded: ${u.pkg} declares ${u.dep} ${u.range} — not resolved: ${u.reason}`);
}
for (const p of problems) {
  console.error(
    `\n  unparsed: ${p.pkg} declares ${p.dep} ${p.range} — "${p.unparsed}" is not ^X.Y.Z`,
  );
}
process.exit(problems.length > 0 ? 1 : 0);
