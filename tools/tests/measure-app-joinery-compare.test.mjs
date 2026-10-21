// `measure-app-joinery.mjs --compare <before> <after>` (FR-007 of B-018).
//
// The script is spawned as a process, because its contract is its exit code and its stdout: the
// Goal of B-018 reads both, and a measuring tool that exits 0 over nothing reports a perfect score.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../measure-app-joinery.mjs", import.meta.url));

let dir;

function tempDir() {
  dir = mkdtempSync(join(tmpdir(), "joinery-compare-"));
  return dir;
}

function write(name, content) {
  const path = join(dir ?? tempDir(), name);
  writeFileSync(path, content);
  return path;
}

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const BEFORE = [
  'import { TelegramAdapter } from "@theokit/gateway-telegram";',
  "// a comment line is not code",
  "export const a = new TelegramAdapter({ token });",
  "",
  'export const isLine = (p: string) => p === "line";',
].join("\n");

const AFTER = [
  'import { telegramChannel } from "@theokit/gateway-telegram";',
  "export const list = [telegramChannel];",
].join("\n");

describe("measure-app-joinery --compare", () => {
  it("exits 2 when the before file is missing", () => {
    tempDir();
    const missing = join(dir, "nope.ts");
    const result = run("--compare", missing, write("after.ts", AFTER));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(missing);
  });

  it("exits 2 when only one file is given", () => {
    const result = run("--compare", write("before.ts", BEFORE));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage");
  });

  it("prints before, after, delta and the lower-bound label for two files", () => {
    const before = write("before.ts", BEFORE);
    const after = write("after.ts", AFTER);
    const result = run("--compare", before, after);

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.before).toMatchObject({ file: before, code_lines: 3, branches: 2 });
    expect(report.before.sites.map((s) => s.kind)).toEqual(["construct", "comparison"]);
    expect(report.after).toMatchObject({ file: after, code_lines: 2, branches: 0, sites: [] });
    expect(report.delta).toBe(-1);
    expect(report.delta_label).toBe(
      "lower bound: two fixtures written for this measurement, not an app",
    );
  });

  it("exits 2 when more than two files are given", () => {
    const before = write("before.ts", BEFORE);
    const result = run("--compare", before, write("after.ts", AFTER), before);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage");
  });

  it("exits 2 when a path is a directory", () => {
    tempDir();
    const sub = join(dir, "sub");
    mkdirSync(sub);
    const result = run("--compare", sub, write("after.ts", AFTER));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(sub);
  });

  it("exits 2 when a file cannot be parsed", () => {
    const broken = write("broken.ts", "const = ;");
    const result = run("--compare", broken, write("after.ts", AFTER));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(broken);
    expect(result.stderr).toContain("Variable declaration expected.");
  });

  it("keeps the app-root mode unchanged", () => {
    const result = run(tempDir());
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("MEASURED NOTHING");
  });
});
