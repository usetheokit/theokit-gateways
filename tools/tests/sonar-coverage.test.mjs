import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const props = readFileSync(resolve(root, "sonar-project.properties"), "utf8");
const list = (key) =>
  props
    .split("\n")
    .find((l) => l.startsWith(`${key}=`))
    .slice(key.length + 1)
    .split(",");

// How the scanner reads an unmodified `SF:` record: relative to the repository root.
// Returns the repository-relative path of the file it lands on, or null if it lands on none.
const resolveSf = (sf) => {
  const abs = isAbsolute(sf) ? sf : resolve(root, sf);
  const rel = relative(root, abs);
  return rel.startsWith("..") || !existsSync(abs) ? null : rel;
};

describe("resolveSf", () => {
  it("does not resolve a package-relative record that only exists inside a package", () => {
    expect(resolveSf("src/index.ts")).toBeNull();
    expect(resolveSf("packages/gateway-zalo/src/index.ts")).toBe(
      "packages/gateway-zalo/src/index.ts",
    );
  });
});

describe.each([["bot-realtime"], ["gateway-zalo"]])("sonar coverage for packages/%s", (name) => {
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
    // An isolated reports directory: the shared `coverage/` may be written by a concurrent
    // `pnpm -r run test`, so this run neither deletes nor overwrites it.
    const out = mkdtempSync(resolve(tmpdir(), "sonar-cov-"));
    const lcov = resolve(out, "lcov.info");
    try {
      // The package's real `test` script; only the output directory is redirected, by an
      // argument pnpm appends to that script. The script and config must not pin their own
      // directory, so the default `coverage/` that `sonar.javascript.lcov.reportPaths` lists is
      // where an unredirected run writes.
      const pkg = JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf8"));
      const cfg = readFileSync(resolve(root, dir, "vitest.config.ts"), "utf8");
      expect(pkg.scripts.test).not.toContain("reportsDirectory");
      expect(cfg).not.toContain("reportsDirectory");
      execFileSync("pnpm", ["run", "test", `--coverage.reportsDirectory=${out}`], {
        cwd: resolve(root, dir),
        stdio: "pipe",
      });
    } catch (e) {
      rmSync(out, { recursive: true, force: true });
      throw e;
    }
    expect(existsSync(lcov)).toBe(true);

    const text = readFileSync(lcov, "utf8");
    rmSync(out, { recursive: true, force: true });
    const files = [...text.matchAll(/^SF:(.+)$/gm)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(0);
    const sources = list("sonar.sources");
    for (const f of files) {
      const resolved = resolveSf(f);
      expect(resolved, `SF:${f} resolves to no file`).not.toBeNull();
      expect(resolved.startsWith(`${dir}/src/`), `SF:${f} is attributed outside ${dir}`).toBe(true);
      expect(sources.some((s) => resolved.startsWith(`${s}/`))).toBe(true);
    }
    const src = execFileSync("git", ["ls-files", `${dir}/src`], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
    for (const f of src) expect(files.map(resolveSf)).toContain(f);
    expect(text).toMatch(/^LH:[1-9]\d*$/m);
  }, 120_000);
});

describe("coverage:sonar", () => {
  it("runs the coverage suites and then the Sonar scanner on this properties file", () => {
    const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const cmd = rootPkg.scripts["coverage:sonar"];
    expect(cmd).toMatch(/^pnpm -r run test && .*@sonar\/scan/);
  });
});
