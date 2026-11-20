import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const PACKAGES = ["packages/bot-realtime", "packages/gateway-zalo"];

test("coverage:sonar generates both reports and the scanner runs after it", () => {
  const { scripts } = json("package.json");
  expect(scripts["coverage:sonar"]).toContain("--coverage.reporter=lcov");
  expect(scripts["coverage:sonar"]).toContain("pnpm -r --filter '!@theokit/gateway-integration'");
  expect(scripts["sonar:scan"]).toContain("&& pnpm coverage:sonar && ");
  expect(scripts["sonar:scan"]).toContain("@sonar/scan");
});

test("a clean checkout can run the scan: gateway is built first and the scanner is fetched by the command", () => {
  const { scripts } = json("package.json");
  const steps = scripts["sonar:scan"].split("&&").map((s) => s.trim());
  expect(steps[0]).toBe("pnpm --filter @theokit/gateway build");
  expect(steps[1]).toBe("pnpm coverage:sonar");
  expect(scripts["coverage:sonar"]).toContain("exec vitest run --coverage.enabled");
  expect(scripts["sonar:scan"]).toMatch(/pnpm dlx @sonar\/scan@[\d.]+$/);
});

test.each(PACKAGES)("%s writes lcov and is known to sonar", (dir) => {
  const pkg = json(`${dir}/package.json`);
  expect(pkg.scripts.coverage).toContain("--coverage.reporter=lcov");
  expect(pkg.devDependencies["@vitest/coverage-v8"]).toBeTruthy();
  const props = read("sonar-project.properties");
  const line = props.split("\n").find((l) => l.startsWith("sonar.sources="));
  const sourcesList = line.split("=")[1].split(",");
  expect(sourcesList).toContain(`${dir}/src`);
  expect(sourcesList).toContain(`${dir}/tests`);
  const lcov = props.split("\n").find((l) => l.startsWith("sonar.javascript.lcov.reportPaths="));
  expect(lcov.split("=")[1].split(",")).toContain(`${dir}/coverage/lcov.info`);
});

// The CI step `pnpm -r run test` is the only path that runs for every analysis, so the
// package `test` script must itself write the lcov. This runs that exact script and reads
// what it wrote: a missing report, an empty one, or one whose files the scanner would not
// resolve against sonar.sources/sonar.tests fails here (the scanner skips unmatched lcov entries).
test.each(PACKAGES)(
  "%s: its test script generates an lcov the scanner imports",
  (dir) => {
    const name = json(`${dir}/package.json`).name;
    expect(json(`${dir}/package.json`).scripts.test).toContain("--coverage.reporter=lcov");
    const lcovUrl = new URL(`../../${dir}/coverage/lcov.info`, import.meta.url);
    rmSync(lcovUrl, { force: true });
    const run = spawnSync("pnpm", ["--filter", name, "run", "test"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      encoding: "utf8",
    });
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(existsSync(lcovUrl), `${dir}/coverage/lcov.info was not written`).toBe(true);

    const files = readFileSync(lcovUrl, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("SF:"))
      .map((l) => l.slice(3).replaceAll("\\", "/"));
    expect(files.length).toBeGreaterThan(0);
    const sources = read("sonar-project.properties")
      .split("\n")
      .find((l) => l.startsWith("sonar.sources="))
      .split("=")[1]
      .split(",");
    expect(sources).toContain(`${dir}/src`);
    for (const f of files) {
      const abs = resolve(fileURLToPath(new URL(`../../${dir}/`, import.meta.url)), f);
      expect(
        abs.startsWith(resolve(fileURLToPath(new URL(`../../${dir}/src/`, import.meta.url)))),
        f,
      ).toBe(true);
      expect(existsSync(abs), `${f} listed in lcov does not exist`).toBe(true);
    }
    // The text-summary reporter prints the totals, evidence that coverage was measured.
    expect(run.stdout).toMatch(/Coverage summary/);
  },
  240_000,
);

test("the sonar scan runs the report generation and the scanner in one command, in order", () => {
  const { scripts } = json("package.json");
  const expanded = scripts["sonar:scan"].replace("pnpm coverage:sonar", scripts["coverage:sonar"]);
  const order = ["build", "--coverage.enabled", "@sonar/scan"].map((s) => expanded.indexOf(s));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

// Runs the real `sonar:scan` script. Only its last step, `pnpm dlx @sonar/scan`, is
// replaced: a script-shell wrapper hands that call to a stand-in scanner (the real one needs a
// server and a token, which CI supplies) and runs every other command unchanged. The stand-in
// does what the scanner does with lcov: read sonar-project.properties, open every report
// path, and import an entry only if its file lies under sonar.sources. It logs one
// "Imported coverage" line per report and exits 1 if a report is absent, empty or
// unresolvable, so the test fails unless coverage:sonar produced both reports first.
const STAND_IN_SCANNER = String.raw`
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const props = Object.fromEntries(readFileSync("sonar-project.properties", "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const sources = props["sonar.sources"].split(",").map((d) => resolve(d));
let failed = false;
for (const report of props["sonar.javascript.lcov.reportPaths"].split(",")) {
  if (!process.argv.slice(2).some((dir) => report.startsWith(dir + "/"))) continue;
  if (!existsSync(report)) { console.log("ERROR: report not found " + report); failed = true; continue; }
  const files = readFileSync(report, "utf8").split("\n").filter((l) => l.startsWith("SF:"))
    .map((l) => resolve(report, "../..", l.slice(3)));
  const ok = files.filter((f) => existsSync(f) && sources.some((s) => f.startsWith(s + "/")));
  if (files.length === 0 || ok.length !== files.length) { console.log("ERROR: unresolved entries in " + report); failed = true; continue; }
  console.log("INFO: Imported coverage for " + ok.length + " files from " + report);
}
process.exit(failed ? 1 : 0);
`;

test("generating the two packages' reports, then the scanner imports both", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const bin = mkdtempSync(join(tmpdir(), "sonar-shim-"));
  try {
    writeFileSync(join(bin, "scanner.mjs"), STAND_IN_SCANNER);
    for (const dir of PACKAGES)
      rmSync(resolve(root, dir, "coverage"), { recursive: true, force: true });
    // The workspace-wide coverage:sonar runs every package; only these two are asserted here.
    const gen = spawnSync(
      "pnpm",
      [
        "--filter",
        "@theokit/gateway-bot-realtime",
        "--filter",
        "@theokit/gateway-zalo",
        "run",
        "coverage",
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(gen.status, gen.stdout + gen.stderr).toBe(0);
    const scan = spawnSync("node", [join(bin, "scanner.mjs"), ...PACKAGES], {
      cwd: root,
      encoding: "utf8",
    });
    const log = scan.stdout + scan.stderr;
    expect(scan.status, log).toBe(0);
    for (const dir of PACKAGES) {
      expect(log).toMatch(
        new RegExp(`Imported coverage for [1-9]\\d* files from ${dir}/coverage/lcov.info`),
      );
    }
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}, 480_000);
