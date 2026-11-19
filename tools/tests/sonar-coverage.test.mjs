import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const props = readFileSync(resolve(root, "sonar-project.properties"), "utf8");
const list = (key) =>
  props
    .split("\n")
    .find((l) => l.startsWith(`${key}=`))
    .slice(key.length + 1)
    .split(",");

describe.each([
  ["bot-realtime", "@theokit/gateway-bot-realtime"],
  ["gateway-zalo", "@theokit/gateway-zalo"],
])("sonar coverage for packages/%s", (name, pkgName) => {
  const dir = `packages/${name}`;

  it("lists the source root, test root and LCOV report", () => {
    expect(list("sonar.sources")).toContain(`${dir}/src`);
    expect(list("sonar.tests")).toContain(`${dir}/tests`);
    expect(list("sonar.javascript.lcov.reportPaths")).toContain(`${dir}/coverage/lcov.info`);
  });

  it("writes the report from the package's ordinary test script", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf8"));
    expect(pkg.scripts.test).toContain("--coverage");
    expect(pkg.devDependencies["@vitest/coverage-v8"]).toBeDefined();
  });

  it("generates a report whose records land on indexed Sonar source files", () => {
    const lcov = resolve(root, dir, "coverage/lcov.info");
    rmSync(resolve(root, dir, "coverage"), { recursive: true, force: true });
    execFileSync("pnpm", ["--filter", pkgName, "run", "test"], { cwd: root, stdio: "pipe" });
    expect(existsSync(lcov)).toBe(true);

    const text = readFileSync(lcov, "utf8");
    const files = [...text.matchAll(/^SF:(.+)$/gm)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(0);
    const sources = list("sonar.sources");
    for (const f of files) {
      // Sonar sees the repository-relative path of the record.
      const repoPath = `${dir}/${f}`;
      expect(existsSync(resolve(root, repoPath))).toBe(true);
      expect(sources.some((s) => repoPath.startsWith(`${s}/`))).toBe(true);
    }
    expect(text).toMatch(/^LH:[1-9]\d*$/m);
  }, 120_000);
});
