// Files reached only by a path knip's import graph cannot follow (a copied subprocess script, a
// vitest setup named in a spawned config, a type shim) must be declared in knip.json as entries.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("knip unused files", () => {
  it("reports_no_unimported_file", () => {
    const run = spawnSync("pnpm", ["exec", "knip", "--no-progress", "--reporter", "json"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const report = JSON.parse(run.stdout);
    const files = report.files ?? report.issues?.flatMap((i) => i.files ?? []) ?? [];
    expect(files).toEqual([]);
  }, 120_000);
});
