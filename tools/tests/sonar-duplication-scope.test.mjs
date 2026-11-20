import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Duplication analysis must keep covering every channel.ts and test file in every package.
const FILES = ["sonar-project.properties", ".sonarcloud.properties"];
const ROOT = new URL("../../", import.meta.url);

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "dist" && e.name !== "coverage") walk(full, out);
    } else out.push(full);
  }
  return out;
};

const analysedFiles = () => {
  const base = fileURLToPath(ROOT);
  const dirs = ["integration", ...readdirSync(`${base}packages`).map((p) => `packages/${p}`)];
  return dirs
    .flatMap((d) => ["src", "tests"].map((s) => `${d}/${s}`))
    .filter((d) => existsSync(`${base}${d}`))
    .flatMap((d) => walk(`${base}${d}`).map((f) => f.slice(base.length)))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"));
};

const toRegExp = (glob) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\/|\*\*|\*/g, (m) =>
        m === "**/" ? "(?:.*/)?" : m === "**" ? ".*" : "[^/]*",
      )}$`,
  );

const globsOf = (file, key) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.startsWith(`${key}=`))
    .flatMap((l) => l.slice(l.indexOf("=") + 1).split(","))
    .map((g) => g.trim())
    .filter(Boolean);

describe("glob matcher", () => {
  it("lets a trailing ** match files below the directory", () => {
    expect(toRegExp("packages/a/tests/**").test("packages/a/tests/x/y.test.ts")).toBe(true);
    expect(toRegExp("**/tests/**").test("packages/a/tests/x.ts")).toBe(true);
    expect(toRegExp("**/*.d.ts").test("a/b.d.ts")).toBe(true);
    expect(toRegExp("packages/a/tests/**").test("packages/b/tests/x.ts")).toBe(false);
  });
});

describe("sonar duplication scope", () => {
  const files = analysedFiles();

  it("finds channel.ts and test files in every package", () => {
    expect(files.filter((f) => f.endsWith("/src/channel.ts")).length).toBeGreaterThan(10);
    expect(files.filter((f) => /\.test\.tsx?$/.test(f)).length).toBeGreaterThan(20);
  });

  for (const file of FILES) {
    for (const key of ["sonar.cpd.exclusions", "sonar.exclusions"]) {
      it(`${file} ${key} matches no channel.ts or test file`, () => {
        const regs = globsOf(file, key).map((g) => [g, toRegExp(g)]);
        const hits = files.flatMap((f) =>
          regs.filter(([, r]) => r.test(f)).map(([g]) => `${f} <- ${g}`),
        );
        expect(hits).toEqual([]);
      });
    }
  }
});

describe("sonar analysis roots", () => {
  const prop = (name) =>
    readFileSync(new URL("../../sonar-project.properties", import.meta.url), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`))
      ?.slice(name.length + 1)
      .split(",") ?? [];

  it("lists the src and tests directory of every package as sources", () => {
    const sources = prop("sonar.sources");
    const root = new URL("../../packages/", import.meta.url);
    for (const pkg of readdirSync(root)) {
      for (const dir of ["src", "tests"]) {
        if (existsSync(new URL(`${pkg}/${dir}`, root))) {
          expect(sources).toContain(`packages/${pkg}/${dir}`);
        }
      }
    }
  });

  it("does not classify tests as test code, which has no duplication analysis", () => {
    expect(prop("sonar.tests")).toEqual([]);
    expect(prop("sonar.test.inclusions")).toEqual([]);
  });
});

describe("ci workflow runs the sonar pipeline", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const props = readFileSync(new URL("../../sonar-project.properties", import.meta.url), "utf8");
  const at = (s) => ci.indexOf(s);

  it("scans after the offline integration units", () => {
    const units = at("run: pnpm --filter @theokit/gateway-integration test:unit");
    expect(units).toBeGreaterThan(-1);
    expect(at("pnpm sonar:scan\n")).toBeGreaterThan(units);
  });

  it("passes SONAR_TOKEN to the scan", () => {
    expect(ci).toMatch(
      /pnpm sonar:scan\n[\s\S]*?env:\s+SONAR_TOKEN: \$\{\{ secrets\.SONAR_TOKEN \}\}/,
    );
  });

  describe("scan step guard", () => {
    // Run the step's real shell block against a throwaway package.json and a stub `pnpm`.
    const runStep = (scripts) => {
      const block = ci.match(/- name: Sonar scan[\s\S]*?run: \|\n([\s\S]*?)\n {8}env:/)?.[1];
      expect(block).toBeTruthy();
      const dir = mkdtempSync(`${tmpdir()}/sonar-step-`);
      const bin = `${dir}/bin`;
      mkdirSync(bin);
      writeFileSync(`${bin}/pnpm`, '#!/bin/sh\necho "pnpm $*"\n');
      chmodSync(`${bin}/pnpm`, 0o755);
      writeFileSync(`${dir}/package.json`, JSON.stringify({ scripts }));
      return spawnSync("bash", ["-e", "-c", block], {
        cwd: dir,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: "utf8",
      });
    };

    it("invokes pnpm sonar:scan when the script exists", () => {
      const r = runStep({ "sonar:scan": "x" });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("pnpm sonar:scan");
    });

    it("warns and skips instead of failing when the script is missing", () => {
      const r = runStep({});
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("pnpm sonar:scan");
      expect(r.stdout).toContain("::warning::");
    });
  });

  it("imports the lcov files that coverage:sonar writes, incl. offline integration", () => {
    expect(props).toContain("integration/coverage/lcov.info");
    expect(props).toContain("tools/coverage/lcov.info");
    expect(props).toContain("packages/gateway/coverage/lcov.info");
  });
});
