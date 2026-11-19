import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Duplication analysis must keep covering channel.ts and test files in every package.
const FILES = ["sonar-project.properties", ".sonarcloud.properties"];
const PATHS = [
  "packages/gateway-line/src/channel.ts",
  "packages/gateway-sms/src/channel.ts",
  "packages/gateway-slack/tests/channel.test.ts",
  "packages/gateway/tests/anything.spec.ts",
];

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

const cpdExclusions = (file) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("sonar.cpd.exclusions="))
    .flatMap((l) => l.slice(l.indexOf("=") + 1).split(","))
    .map((g) => g.trim())
    .filter(Boolean);

describe("sonar duplication scope", () => {
  for (const file of FILES) {
    it(`${file} does not exclude channel or test files from duplication analysis`, () => {
      const globs = cpdExclusions(file);
      for (const p of PATHS) {
        expect(globs.filter((g) => toRegExp(g).test(p))).toEqual([]);
      }
    });
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

  it("keeps packages without an imported lcov report out of the coverage metric", () => {
    const reports = prop("sonar.javascript.lcov.reportPaths");
    const excluded = prop("sonar.coverage.exclusions").map(toRegExp);
    const root = new URL("../../packages/", import.meta.url);
    for (const pkg of readdirSync(root)) {
      if (!existsSync(new URL(`${pkg}/src`, root))) continue;
      if (reports.includes(`packages/${pkg}/coverage/lcov.info`)) continue;
      expect(excluded.some((re) => re.test(`packages/${pkg}/src/index.ts`))).toBe(true);
    }
  });

  it("does not classify tests as test code, which has no duplication analysis", () => {
    expect(prop("sonar.tests")).toEqual([]);
    expect(prop("sonar.test.inclusions")).toEqual([]);
  });
});
