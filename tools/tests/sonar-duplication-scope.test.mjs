import { existsSync, readdirSync, readFileSync } from "node:fs";
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
    "^" +
      glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*\/?/g, "@@GLOBSTAR@@")
        .replace(/\*/g, "[^/]*")
        .replace(/@@GLOBSTAR@@/g, "(?:.*/)?") +
      "$",
  );

const globsOf = (file, key) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.startsWith(`${key}=`))
    .flatMap((l) => l.slice(l.indexOf("=") + 1).split(","))
    .map((g) => g.trim())
    .filter(Boolean);

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
