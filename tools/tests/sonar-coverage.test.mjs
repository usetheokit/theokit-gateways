import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const json = (path) => JSON.parse(read(path));
const PACKAGES = ["packages/bot-realtime", "packages/gateway-zalo"];

test("coverage:sonar generates both reports and the scanner runs after it", () => {
  const { scripts } = json("package.json");
  for (const name of ["gateway-bot-realtime", "gateway-zalo"]) {
    expect(scripts["coverage:sonar"]).toContain(`@theokit/${name}`);
  }
  expect(scripts["sonar:scan"].startsWith("pnpm coverage:sonar && ")).toBe(true);
  expect(scripts["sonar:scan"]).toContain("@sonar/scan");
});

test("a clean checkout can run the scan: gateway is built first and the scanner is fetched by the command", () => {
  const { scripts } = json("package.json");
  const steps = scripts["coverage:sonar"].split("&&").map((s) => s.trim());
  expect(steps[0]).toBe("pnpm --filter @theokit/gateway build");
  expect(steps[1]).toContain("run coverage");
  expect(scripts["sonar:scan"]).toMatch(/pnpm dlx @sonar\/scan$/);
});

test.each(PACKAGES)("%s writes lcov and is known to sonar", (dir) => {
  const pkg = json(`${dir}/package.json`);
  expect(pkg.scripts.coverage).toContain("--coverage.reporter=lcov");
  expect(pkg.devDependencies["@vitest/coverage-v8"]).toBeTruthy();
  const props = read("sonar-project.properties");
  for (const key of ["sonar.sources", "sonar.tests"]) {
    const line = props.split("\n").find((l) => l.startsWith(`${key}=`));
    expect(line.split("=")[1].split(",")).toContain(
      `${dir}/${key === "sonar.sources" ? "src" : "tests"}`,
    );
  }
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
  const order = ["build", "run coverage", "@sonar/scan"].map((s) => expanded.indexOf(s));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

// Runs the root command the Sonar scan runs first, then checks the evidence the scanner
// needs: both lcov files exist, are non-empty, and every SF: entry sits under the
// sonar.sources of its package and is listed in sonar.javascript.lcov.reportPaths.
test("pnpm coverage:sonar really writes both reports the scanner is told to import", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  for (const dir of PACKAGES) rmSync(resolve(root, dir, "coverage/lcov.info"), { force: true });
  const run = spawnSync("pnpm", ["coverage:sonar"], { cwd: root, encoding: "utf8" });
  expect(run.status, run.stdout + run.stderr).toBe(0);
  const reportPaths = read("sonar-project.properties")
    .split("\n")
    .find((l) => l.startsWith("sonar.javascript.lcov.reportPaths="))
    .split("=")[1]
    .split(",");
  for (const dir of PACKAGES) {
    expect(reportPaths).toContain(`${dir}/coverage/lcov.info`);
    const file = resolve(root, dir, "coverage/lcov.info");
    expect(existsSync(file), `${dir} lcov missing after coverage:sonar`).toBe(true);
    const sf = readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("SF:"))
      .map((l) => resolve(root, dir, l.slice(3)));
    expect(sf.length).toBeGreaterThan(0);
    for (const f of sf) expect(f.startsWith(resolve(root, dir, "src")), f).toBe(true);
  }
}, 480_000);
