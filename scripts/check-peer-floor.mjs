#!/usr/bin/env node
/**
 * Install every publishable adapter against the EXACT `@theokit/gateway` its peer range names as
 * its floor, and import it. npm accepts any version the range allows, so a floor below the core
 * that ships what the adapter imports installs cleanly and then fails at import time (#422).
 *
 * Usage:
 *   node scripts/check-peer-floor.mjs                       every adapter in packages/ (build first)
 *   node scripts/check-peer-floor.mjs --only gateway-zalo   one workspace adapter
 *   node scripts/check-peer-floor.mjs --adapter @theokit/gateway-zalo@0.1.0 --core 0.12.0
 *                                                           a published adapter against a chosen core
 *
 * Needs network access to the npm registry. Exits non-zero when any import fails.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = "@theokit/gateway";

/** The exact version a `>=X.Y.Z <N` range names as its floor, or `undefined`. */
export function floorOf(range) {
  const m = /^\s*>=\s*(\d+\.\d+\.\d+)(?:\s|$)/.exec(range ?? "");
  return m === null ? undefined : m[1];
}

/** Manifests that publish and declare a core peer: `{ name, dir, floor }`. */
export function publishableAdapters(packagesDir = join(ROOT, "packages")) {
  const out = [];
  for (const entry of readdirSync(packagesDir).sort()) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(packagesDir, entry, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (manifest.private === true || manifest.name === CORE) continue;
    const range = manifest.peerDependencies?.[CORE];
    if (range === undefined) continue;
    out.push({ name: manifest.name, dir: join(packagesDir, entry), floor: floorOf(range), range });
  }
  return out;
}

/** Run `check` per case; returns the failures as `{ label, message }`. */
export async function runChecks(cases, check) {
  const failures = [];
  for (const c of cases) {
    try {
      await check(c);
    } catch (e) {
      failures.push({ label: c.label, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return failures;
}

const sh = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Install `adapterSpec` beside core `coreVersion` in a fresh temp dir and import the adapter. */
export function installAndImport({ adapterSpec, adapterName, coreVersion }) {
  const dir = mkdtempSync(join(tmpdir(), "peer-floor-"));
  try {
    writeFileSync(join(dir, "package.json"), '{"name":"probe","private":true,"type":"module"}');
    // `--legacy-peer-deps` would hide the very mismatch being tested, so it is not used.
    sh("npm", ["install", "--no-audit", "--no-fund", `${CORE}@${coreVersion}`, adapterSpec], dir);
    const probe = join(dir, "probe.mjs");
    writeFileSync(probe, `await import(${JSON.stringify(adapterName)});\n`);
    sh("node", [probe], dir);
  } catch (e) {
    const detail = e.stderr ? String(e.stderr).trim().split("\n").slice(-8).join(" | ") : e.message;
    throw new Error(detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Pack a workspace package and return its tarball, whatever else pnpm prints. */
function packWorkspace(dir, into) {
  const dest = mkdtempSync(join(into, "adapter-"));
  sh("pnpm", ["pack", "--pack-destination", dest], dir);
  const tarballs = readdirSync(dest).filter((f) => f.endsWith(".tgz"));
  if (tarballs.length !== 1)
    throw new Error(`pnpm pack of ${dir} produced ${tarballs.length} tarballs`);
  return join(dest, tarballs[0]);
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function casesFor(argv) {
  const adapter = flag(argv, "--adapter");
  const core = flag(argv, "--core");
  const only = flag(argv, "--only");
  if (adapter !== undefined) {
    if (core === undefined) throw new Error("--adapter needs --core <version>");
    const at = adapter.lastIndexOf("@");
    return [
      {
        label: adapter,
        adapterSpec: adapter,
        adapterName: at > 0 ? adapter.slice(0, at) : adapter,
        coreVersion: core,
      },
    ];
  } else {
    return publishableAdapters()
      .filter((a) => only === undefined || a.name.endsWith(`/${only}`) || a.name === only)
      .map((a) => ({
        label: a.name,
        adapterName: a.name,
        coreVersion: core ?? a.floor,
        dir: a.dir,
        range: a.range,
      }));
  }
}

/** Returns the exit code: 0 all imports work, 1 some failed. Throws on bad usage (caller exits 2). */
export async function main(argv, deps = {}) {
  const install = deps.install ?? installAndImport;
  const pack = deps.pack ?? packWorkspace;
  const cases = casesFor(argv);
  const packDir = mkdtempSync(join(tmpdir(), "peer-floor-pack-"));
  let failures;
  try {
    failures = await runChecks(cases, (c) => {
      if (c.coreVersion === undefined) throw new Error(`cannot read a floor from "${c.range}"`);
      const spec = c.adapterSpec ?? pack(c.dir, packDir);
      install({ adapterSpec: spec, adapterName: c.adapterName, coreVersion: c.coreVersion });
      console.log(`ok   ${c.label} against ${CORE}@${c.coreVersion}`);
    });
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
  for (const f of failures) console.error(`FAIL ${f.label}: ${f.message}`);
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message);
      process.exit(2);
    },
  );
}
