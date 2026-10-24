// The dead-code pass runs `pnpm exec knip` at the repository root. Without a root declaration
// that command exits 254 before any analysis, and every audit carries `auditor_unavailable_knip`.
// Each check below names what is missing, and each has a control proving it can fail.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RANGE = "^5.88.1";

function declarationProblem(manifest) {
  if (manifest.devDependencies?.knip !== RANGE) {
    return `devDependencies.knip is ${JSON.stringify(manifest.devDependencies?.knip)}, not ${RANGE}`;
  }
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    if (manifest[field]?.knip !== undefined) {
      return `knip must be a devDependency only, but ${field} also declares it`;
    }
  }
  return undefined;
}

function lockfileProblem(text) {
  const header = /\nimporters:\n+ {2}\.:\n/.exec(text);
  if (!header) return "pnpm-lock.yaml has no root importer";
  const rest = text.slice(header.index + header[0].length);
  const next = rest.search(/\n {2}\S/);
  const rootBlock = next === -1 ? rest : rest.slice(0, next);
  const entry = rootBlock.match(/\n {6}knip:\n {8}specifier: \^5\.88\.1\n {8}version: 5\.\d+\.\d+/);
  return entry ? undefined : "the root importer of pnpm-lock.yaml has no knip entry at ^5.88.1";
}

function versionIsInRange(output) {
  const match = /^5\.(\d+)\.(\d+)/.exec(output.trim());
  if (!match) return false;
  const minor = Number(match[1]);
  const patch = Number(match[2]);
  return minor > 88 || (minor === 88 && patch >= 1);
}

function commandProblem({ status, stdout, stderr }) {
  if (status !== 0) {
    return `pnpm exec knip --version exited ${status}: ${String(stderr).trim()}`;
  }
  if (!versionIsInRange(stdout)) {
    return `pnpm exec knip --version printed "${String(stdout).trim()}", not 5.88.1 or later in 5.x`;
  }
  return undefined;
}

function runKnipVersion() {
  try {
    const stdout = execFileSync("pnpm", ["exec", "knip", "--version"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

describe("knip runs from the repository root", () => {
  it("declares_knip_in_the_root_dev_dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(declarationProblem(manifest)).toBeUndefined();
  });

  it("resolves_knip_in_the_root_importer_of_the_lockfile", () => {
    const text = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");
    expect(lockfileProblem(text)).toBeUndefined();
  });

  it("runs_knip_from_the_repository_root", () => {
    expect(commandProblem(runKnipVersion())).toBeUndefined();
  });

  it("the_declaration_check_names_a_manifest_without_knip", () => {
    expect(declarationProblem({ devDependencies: { typescript: "5.9.3" } })).toContain(
      "devDependencies.knip",
    );
    expect(
      declarationProblem({ devDependencies: { knip: RANGE }, dependencies: { knip: RANGE } }),
    ).toContain("dependencies");
  });

  it("the_lockfile_check_refuses_knip_under_another_importer", () => {
    const elsewhere = [
      "importers:",
      "  .:",
      "    devDependencies:",
      "      typescript:",
      "        specifier: 5.9.3",
      "        version: 5.9.3",
      "  tools:",
      "    devDependencies:",
      "      knip:",
      "        specifier: ^5.88.1",
      "        version: 5.88.1",
      "",
    ].join("\n");
    expect(lockfileProblem(`\n${elsewhere}`)).toContain("root importer");
    const inRoot = elsewhere.replace(
      "      typescript:",
      "      knip:\n        specifier: ^5.88.1\n        version: 5.88.1\n      typescript:",
    );
    expect(lockfileProblem(`\n${inRoot}`)).toBeUndefined();
  });

  it("the_command_check_names_the_exit_status", () => {
    const failed = commandProblem({ status: 254, stdout: "", stderr: 'Command "knip" not found' });
    expect(failed).toContain("254");
    for (const stdout of ["5.88.0\n", "6.0.0\n", ""]) {
      expect(commandProblem({ status: 0, stdout, stderr: "" })).toContain("not 5.88.1 or later");
    }
    expect(commandProblem({ status: 0, stdout: "5.99.0\n", stderr: "" })).toBeUndefined();
    expect(commandProblem({ status: 0, stdout: "5.88.1\n", stderr: "" })).toBeUndefined();
  });
});
