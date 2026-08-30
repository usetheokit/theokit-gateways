#!/usr/bin/env node
// What we EXERCISE must fall inside what we PROMISE.
//
// This gate exists because the two drifted in silence for two majors (#79). `gateway-mattermost`
// declared `peerOptional @mattermost/client: "^9.0.0"`; the integration suite installed 10.12.0 and
// went green against a real server every run. Nothing compared the two, so the declaration went on
// naming a support window nobody had tested the edges of while the suite proved a version the
// package told npm it did not accept.
//
// A consumer found it the only way left: installing the adapter beside the current client, getting
// ERESOLVE, and reaching for --legacy-peer-deps — which re-resolved their whole tree and dropped an
// unrelated peer, so the failure surfaced as a typecheck error with no visible connection to
// Mattermost.
//
// The check is one-directional on purpose. It asserts the tested version is INSIDE the declared
// range; it cannot assert the reverse, because a range may legitimately cover majors nothing here
// installs. What it catches is the case that actually happened: a version we exercise and do not
// support.
//
// IT READS THE PACKAGE'S OWN node_modules, not the integration suite's. The first version of this
// gate read `integration/node_modules/<dep>` and immediately reported a second offender that did
// not exist: pnpm resolves a peer PER CONSUMER, so `integration` had matrix-js-sdk 42.2.0 while the
// adapter — whose `await import()` resolves from its own directory — loaded 32.4.0, which its range
// admits. The version a test exercises is the one the ADAPTER resolves; anything else measures a
// copy no adapter loads.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { publishedPackages } from "./lib/published-entries.mjs";

const LABEL = "peer-range-tested";

/**
 * Does `range` admit `major`? `undefined` when the shape is not one this gate understands.
 *
 * Deliberately NOT a semver implementation — it reads the two shapes the peers here declare, a
 * union of carets and an open `>=` floor, and returns `undefined` for anything else so the caller
 * REFUSES rather than guesses. A gate that answers "fine" about a range it cannot parse reports a
 * check it never made, which is worse than having no gate. Reach for a real semver library the day
 * a third shape appears; until then the dependency costs more than the four lines it replaces.
 */
/** One clause of a range: a caret pinning a major, or an open `>=` floor. `undefined` if unread. */
function clauseOf(part) {
  const caret = /^\s*\^(\d+)\.\d+\.\d+(?:-[\w.]+)?\s*$/.exec(part);
  if (caret !== null) return { open: false, major: Number(caret[1]) };
  const floor = /^\s*>=\s*(\d+)\.\d+\.\d+(?:-[\w.]+)?\s*$/.exec(part);
  if (floor !== null) return { open: true, major: Number(floor[1]) };
  return undefined;
}

function admitsMajor(range, major) {
  const clauses = range.split("||").map(clauseOf);
  // One unreadable clause makes the whole answer unknown — never "fine".
  if (clauses.some((c) => c === undefined)) return undefined;
  return clauses.some((c) => (c.open ? major >= c.major : major === c.major));
}

const packages = publishedPackages();
if (packages.length === 0) {
  // A gate whose green can mean "there was nothing to check" reports absence it never checked.
  console.error(`[${LABEL}] x no published package found — refusing to report success`);
  process.exit(2);
}

const offenders = [];
const checked = [];
let untested = 0;

for (const pkg of packages) {
  const manifest = JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8"));
  for (const [dep, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (dep.startsWith("@theokit/")) continue; // a workspace sibling, not a platform SDK
    const installed = join(pkg.dir, "node_modules", dep, "package.json");
    if (!existsSync(installed)) {
      untested += 1; // nothing installed for this package to load — nothing to compare
      continue;
    }
    const version = JSON.parse(readFileSync(installed, "utf8")).version;
    const major = Number(version.split(".")[0]);
    const admits = admitsMajor(range, major);
    if (admits === undefined) {
      offenders.push(
        `${pkg.name}: peer "${dep}" range ${range} is a shape this gate cannot read — widen the` +
          ` parser or simplify the range, but do not leave it unchecked`,
      );
      continue;
    }
    if (!admits) {
      offenders.push(
        `${pkg.name}: its tests load "${dep}" ${version}, which its own declared peer range` +
          ` ${range} refuses — a consumer installing what we test would get ERESOLVE`,
      );
      continue;
    }
    checked.push(`${pkg.name} ${dep}@${version} in ${range}`);
  }
}

if (offenders.length > 0) {
  for (const line of offenders) console.error(`[${LABEL}] x ${line}`);
  console.error(
    `\n[${LABEL}] FAIL — ${offenders.length} peer declaration(s) refuse the version their own` +
      ` package loads.`,
  );
  process.exit(1);
}

for (const line of checked) console.log(`[${LABEL}] ok ${line}`);
console.log(
  `\n[${LABEL}] PASS — ${checked.length} peer(s) that a package actually loads fall inside its` +
    ` declared range; ${untested} declared peer(s) are not installed for their package, so nothing` +
    ` was compared for them.`,
);
