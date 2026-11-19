import { readFileSync } from "node:fs";
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
  expect(scripts["sonar:scan"]).toContain("sonar-scanner");
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
