#!/usr/bin/env node
// Documentation-vs-API drift gate.
//
// Every README in this repository opens by telling a consumer to write an import. Nothing checked
// that the names in those imports exist. A published example that does not compile is a first
// impression, and it is the cheapest way there is to lose a reader who was about to try the thing.
// Measured 2026-08-20: `gateway-slack`'s README told a reader to import `GatewayMessageEvent`, which
// is an internal alias inside two OTHER adapters and has never been an export of anything.
//
// THE ORACLE IS THE COMPILER, NOT A REGEX OVER `.d.ts` TEXT. Matching names is exactly what fails
// here: an export can be written in a form a hand-rolled parser does not read, and the parser then
// reports a real export as missing. Each documented import becomes a generated probe; `tsc --noEmit`
// says which names do not resolve, and each diagnostic maps back to the artifact and line that
// claimed it.
//
// EVERY SPECIFIER, NOT JUST OURS. The first version matched `@theokit/*` alone, which made an import
// from any other package invisible to it — including the framework this ecosystem is built on. The
// sibling repository `theokit-plugins` found ten documented names missing from `theokit` itself
// while a gate scoped like the first version would have reported all-clear. A gate that cannot see
// a whole class of import reports an absence it never checked.
//
// OUR OWN PACKAGES RESOLVE THROUGH `paths`, NEVER THROUGH A `node_modules` LINK. The two changes
// above are coupled, and the coupling is the point: once an uninstalled specifier is reported as
// out-of-scope rather than as a failure, anything that fails to resolve goes quiet. If our own
// packages resolved through whatever link happened to exist, a dropped dependency would turn OUR
// drift into a silent skip. Mapping the workspace explicitly means "out of scope" can only ever mean
// third-party.
//
// "COULD NOT CHECK" IS NOT "IS WRONG". A third-party package this workspace does not install is
// counted and listed, and does not fail the run — we cannot check it and say so. A name missing from
// a module that DID resolve is drift, and does. The first version conflated the two and accused five
// READMEs of naming types that do not exist, when the truth was that `@theokit/sdk` was not linked
// where the probes stood.
//
// This reads the PUBLISHED declarations, so the build must have run first.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importsIn, isDocumentation } from "./lib/documented-imports.mjs";
import { publishedPackages, ROOT, workspacePaths } from "./lib/published-entries.mjs";

const LABEL = "doc-api-drift";
const PROBE_DIRNAME = ".doc-probes";

/** Tracked markdown that documents an API — see `isDocumentation` for what is deliberately not. */
function documentationFiles() {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((path) => path.length > 0 && isDocumentation(path));
}

/** Where a reader of `file` stands, for THIRD-PARTY specifiers: its own package has its peers. */
function resolutionRoots(file) {
  const owner = /^(packages\/[^/]+)\//.exec(file);
  const roots = owner === null ? [] : [join(ROOT, owner[1])];
  return [...roots, join(ROOT, "integration"), ROOT];
}

function installedRoot(file, specifier) {
  // A subpath import resolves through its package's manifest; the package directory is what exists.
  const pkg = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  return resolutionRoots(file).find((root) =>
    existsSync(join(root, "node_modules", pkg, "package.json")),
  );
}

const WORKSPACE = workspacePaths();

const unbuilt = publishedPackages().filter((pkg) => !pkg.built);
if (unbuilt.length > 0) {
  console.error(
    `[${LABEL}] x ${unbuilt.map((pkg) => pkg.name).join(", ")} publish no declaration — run the build`,
  );
  console.error(
    "  Refusing to report: the names would resolve against declarations that do not exist.",
  );
  process.exit(2);
}

const claims = documentationFiles().flatMap((file) =>
  importsIn(file, readFileSync(join(ROOT, file), "utf8")),
);
if (claims.length === 0) {
  // Not a pass. Every README here opens with an import example; finding none means the extraction
  // broke, and reporting green on that is how a gate starts checking nothing while looking healthy.
  console.error(
    `[${LABEL}] x no documented imports found — the extraction is broken, not the docs`,
  );
  process.exit(2);
}

const outOfScope = [];
const byRoot = new Map();
for (const claim of claims) {
  // Ours always resolves, wherever the probe stands; anything else needs a root that installs it.
  const root =
    WORKSPACE[claim.specifier] === undefined ? installedRoot(claim.file, claim.specifier) : ROOT;
  if (root === undefined) {
    outOfScope.push(claim);
    continue;
  }
  if (!byRoot.has(root)) byRoot.set(root, []);
  byRoot.get(root).push(claim);
}

const drifted = [];
const notChecked = [];

for (const [root, rootClaims] of byRoot) {
  const probeDir = join(root, PROBE_DIRNAME);
  rmSync(probeDir, { recursive: true, force: true });
  mkdirSync(probeDir, { recursive: true });

  // Everything below removes the directory on its way out, including the throw nobody wrote a
  // handler for. Two `rmSync` calls used to cover two of the paths, so an exception between them
  // left probe files in a package root — two agents hit that and one cleaned it by hand (B-016).
  // `.doc-probes/` is also gitignored, which is what covers the paths no `finally` can: a SIGKILL
  // runs nothing.
  try {
    const probes = rootClaims.map((claim, index) => {
      const probe = join(probeDir, `probe-${index}.ts`);
      writeFileSync(
        probe,
        `import type { ${claim.names.join(", ")} } from ${JSON.stringify(claim.specifier)};\n`,
      );
      return { probe, claim };
    });

    writeFileSync(
      join(probeDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            noEmit: true,
            strict: true,
            skipLibCheck: true,
            target: "es2022",
            module: "esnext",
            moduleResolution: "bundler",
            baseUrl: root,
            paths: WORKSPACE,
          },
          files: probes.map((entry) => entry.probe),
        },
        null,
        2,
      ),
    );

    let output = "";
    try {
      execFileSync("npx", ["tsc", "--project", join(probeDir, "tsconfig.json")], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      // A failed invocation is not a clean compile.
      if (typeof error.status !== "number") {
        console.error(`[${LABEL}] x tsc could not be run: ${error.message}`);
        console.error(
          "  Refusing to report: a gate that cannot invoke its tool has checked nothing.",
        );
        // `process.exit` does not unwind the stack, so the `finally` below never runs on this
        // path. The clean-up has to happen here or the probe files stay — which is the defect
        // this file's `finally` was added to fix, reintroduced on the one path it cannot reach.
        rmSync(probeDir, { recursive: true, force: true });
        process.exit(2);
      }
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }

    for (const raw of output.split("\n")) {
      const match = /probe-(\d+)\.ts\(\d+,\d+\): error (TS\d+): (.+)$/.exec(raw.trim());
      if (match === null) continue;
      const entry = probes[Number(match[1])];
      if (entry === undefined) continue;
      if (match[2] === "TS2307") {
        // The module did not resolve where the probe stood. For one of ours that is a broken gate,
        // never a documentation defect — and it must be loud, or our own drift goes quiet.
        notChecked.push({ ...entry.claim, ours: WORKSPACE[entry.claim.specifier] !== undefined });
        continue;
      }
      const name = /has no exported member(?: named)? '([^']+)'/.exec(match[3])?.[1];
      drifted.push({ ...entry.claim, name: name ?? entry.claim.names.join(", ") });
    }
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

const checkedNames = claims
  .filter((claim) => !outOfScope.includes(claim))
  .reduce((total, claim) => total + claim.names.length, 0);

if (outOfScope.length > 0) {
  console.log(
    `[${LABEL}] ${outOfScope.length} import(s) NOT checked — package not installed here:`,
  );
  for (const claim of outOfScope) {
    console.log(`      ${claim.file}:${claim.line} — ${claim.specifier}`);
  }
  console.log("  Third-party and absent from this workspace, so the names could not be verified.");
}

if (notChecked.length > 0) {
  console.error(`\n[${LABEL}] x ${notChecked.length} probe(s) could not resolve their module:`);
  for (const claim of notChecked) {
    console.error(
      `      ${claim.file}:${claim.line} — ${claim.specifier}${claim.ours ? "  (OURS — the gate is broken, not the doc)" : ""}`,
    );
  }
}

if (drifted.length > 0) {
  console.error(`\n[${LABEL}] FAIL — ${drifted.length} documented name(s) do not exist:`);
  for (const item of drifted) {
    console.error(`      ${item.file}:${item.line} — ${item.specifier} has no '${item.name}'`);
  }
  console.error("\n  A reader who copies one of these gets code that does not compile.");
}

if (drifted.length > 0) process.exit(1);
if (notChecked.length > 0) process.exit(2);

console.log(
  `\n[${LABEL}] PASS — ${checkedNames} documented name(s) across ${claims.length - outOfScope.length} import(s) in ${
    new Set(claims.map((claim) => claim.file)).size
  } file(s) all resolve.`,
);
