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

  it("is reached by the checked-in CI test flow", () => {
    const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(rootPkg.scripts.test).toBe("pnpm -r run test");
    const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("run: pnpm -r run test");
    const cfg = readFileSync(resolve(root, dir, "vitest.config.ts"), "utf8");
    expect(cfg).toMatch(/reporter:\s*\[[^\]]*"lcov"/);
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
    const src = execFileSync("git", ["ls-files", `${dir}/src`], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
    for (const f of src) expect(files).toContain(f.slice(dir.length + 1));
    expect(text).toMatch(/^LH:[1-9]\d*$/m);
  }, 120_000);
});
