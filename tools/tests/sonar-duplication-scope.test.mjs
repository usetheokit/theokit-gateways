import { readFileSync } from "node:fs";
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
        .replace(/\*\*\/?/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\u0000/g, "(?:.*/)?") +
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
