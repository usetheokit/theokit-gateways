import { existsSync, readFileSync } from "node:fs";
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

  it("has a coverage script and a config that writes LCOV for src", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf8"));
    expect(pkg.scripts.coverage).toContain("--coverage");
    expect(pkg.devDependencies["@vitest/coverage-v8"]).toBeDefined();
    const config = readFileSync(resolve(root, dir, "vitest.config.ts"), "utf8");
    expect(config).toContain('"lcov"');
    expect(config).toContain("src/**/*.ts");
  });

  it("is run by the root coverage:sonar script", () => {
    const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(rootPkg.scripts["coverage:sonar"]).toContain(pkgName);
  });

  it("writes LCOV records for existing source files with covered lines (when generated)", () => {
    const lcov = resolve(root, dir, "coverage/lcov.info");
    if (!existsSync(lcov)) return;
    const text = readFileSync(lcov, "utf8");
    const files = [...text.matchAll(/^SF:(.+)$/gm)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(existsSync(resolve(root, dir, f))).toBe(true);
    expect(text).toMatch(/^LH:[1-9]\d*$/m);
  });
});
