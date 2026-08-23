#!/usr/bin/env node
// Every published package declares the repository npm's provenance check reads.
//
// This gate exists because a release burned nine minutes to find out it did not. All eleven
// packages set `publishConfig.provenance: true`; npm verifies the signed bundle against
// `repository.url`; none of the eleven declared a repository; the registry answered
//
//   422 … Error verifying sigstore provenance bundle: Failed to validate repository information:
//   package.json: "repository.url" is "", expected to match https://github.com/usetheokit/…
//
// and refused all eleven at once, AFTER the build, the test suite and the live platform gate had
// all passed. Nothing about the packages had changed: npm began enforcing what it had tolerated,
// and no gate here could see the difference until a publish failed.
//
// Runs in milliseconds, reads package.json only, and needs no network — the opposite trade from
// the thing it protects.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { publishedPackages } from "./lib/published-entries.mjs";
import { repositoryProblem } from "./lib/repository-field.mjs";

const LABEL = "repository-field";

const packages = publishedPackages();
if (packages.length === 0) {
  // A gate whose green can mean "there was nothing to check" reports absence it never checked.
  console.error(`[${LABEL}] x no published package found — refusing to report success`);
  process.exit(2);
}

const offenders = [];
for (const pkg of packages) {
  const manifest = JSON.parse(readFileSync(`${pkg.dir}/package.json`, "utf8"));
  const problem = repositoryProblem(manifest, basename(pkg.dir));
  if (problem !== undefined) offenders.push(`${pkg.name}: ${problem}`);
}

if (offenders.length > 0) {
  for (const line of offenders) console.error(`[${LABEL}] x ${line}`);
  console.error(
    `\n[${LABEL}] FAIL — ${offenders.length} of ${packages.length} package(s) would be refused by` +
      ` npm at publish, or would send consumers to the wrong source.`,
  );
  process.exit(1);
}

console.log(
  `\n[${LABEL}] PASS — ${packages.length} published package(s) declare the repository npm verifies.`,
);
