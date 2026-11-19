import { existsSync, readFileSync } from "node:fs";
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

// Evidence from a real run: when coverage was generated (coverage:sonar), the lcov must
// cover files that sonar.sources knows, so the scanner imports it rather than skipping it.
test.each(PACKAGES)("%s lcov, when generated, only lists files under its sonar source dir", (dir) => {
  const path = new URL(`../../${dir}/coverage/lcov.info`, import.meta.url);
  if (!existsSync(path)) return;
  const files = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.startsWith("SF:"))
    .map((l) => l.slice(3));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) expect(f.replaceAll("\\", "/")).toMatch(/^(src\/|\/.*\/src\/)/);
});

test("the sonar scan runs the report generation and the scanner in one command, in order", () => {
  const { scripts } = json("package.json");
  const expanded = scripts["sonar:scan"].replace("pnpm coverage:sonar", scripts["coverage:sonar"]);
  const order = ["build", "run coverage", "@sonar/scan"].map((s) => expanded.indexOf(s));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});
