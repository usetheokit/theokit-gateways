import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const PACKAGES = ["packages/bot-realtime", "packages/gateway-zalo"];
const SCANNER = "pnpm dlx @sonar/scan@5.1.0";

const props = () =>
  Object.fromEntries(
    read("sonar-project.properties")
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );

test("sonar:scan builds gateway, generates coverage, then runs the pinned scanner, in that order", () => {
  const { scripts } = JSON.parse(read("package.json"));
  expect(scripts["sonar:scan"].split("&&").map((s) => s.trim())).toEqual([
    "pnpm --filter @theokit/gateway build",
    "pnpm coverage:sonar",
    SCANNER,
  ]);
  expect(scripts["coverage:sonar"]).toContain("--coverage.reporter=lcov");
});

test.each(PACKAGES)("%s is a sonar source and its lcov is a report path", (dir) => {
  const p = props();
  const sources = p["sonar.sources"].split(",");
  expect(sources).toContain(`${dir}/src`);
  expect(sources).toContain(`${dir}/tests`);
  expect(p["sonar.javascript.lcov.reportPaths"].split(",")).toContain(`${dir}/coverage/lcov.info`);
});

// Stand-in for the scanner, which needs a server and a token that only CI has. It is weaker
// evidence than the real scanner: it applies its own resolver (read each lcov report path,
// accept an SF: entry only if the file exists under sonar.sources) rather than the scanner's
// rules. It logs one "Imported coverage" line per report and exits 1 on an absent, empty or
// unresolvable report.
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

// Runs the real `pnpm sonar:scan`. pnpm runs scripts through its script-shell, so that is
// where only the last step, the scanner, is swapped for the stand-in; the build and
// coverage:sonar run unchanged. The test fails unless coverage:sonar wrote both reports first.
// coverage:sonar also runs this tools suite, which would start sonar:scan again and delete the
// reports the outer run is writing; the marker env var makes the nested run skip this test.
test.skipIf(process.env.SONAR_SCAN_REGRESSION)(
  "pnpm sonar:scan generates both reports, then the scanner imports both",
  () => {
    const bin = mkdtempSync(join(tmpdir(), "sonar-shim-"));
    try {
      writeFileSync(join(bin, "scanner.mjs"), STAND_IN_SCANNER);
      writeFileSync(
        join(bin, "shell.sh"),
        `#!/bin/sh
cmd="$2"
last="${SCANNER}"
case "$cmd" in
  *"&& $last") /bin/sh -c "\${cmd%"&& $last"}" && exec node "${join(bin, "scanner.mjs")}" ${PACKAGES.join(" ")} ;;
  *) exec /bin/sh -c "$cmd" ;;
esac
`,
        { mode: 0o755 },
      );
      for (const dir of PACKAGES)
        rmSync(resolve(root, dir, "coverage"), { recursive: true, force: true });
      const run = spawnSync("pnpm", ["sonar:scan"], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          SONAR_SCAN_REGRESSION: "1",
          npm_config_script_shell: join(bin, "shell.sh"),
        },
      });
      const log = run.stdout + run.stderr;
      expect(run.status, log).toBe(0);
      for (const dir of PACKAGES) {
        expect(existsSync(join(root, dir, "coverage/lcov.info"))).toBe(true);
        expect(log).toMatch(
          new RegExp(`Imported coverage for [1-9]\\d* files from ${dir}/coverage/lcov.info`),
        );
      }
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  },
  540_000,
);
