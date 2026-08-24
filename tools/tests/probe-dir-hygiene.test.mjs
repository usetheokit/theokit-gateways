import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// `quality:docs` writes probe files into package roots to typecheck what the documentation claims,
// and cleans them on the paths it knows about. It cannot clean on the paths it does not: a Ctrl-C,
// a SIGTERM, a crash between creating the directory and removing it. Two agents hit that during
// B-008's review and one cleaned it by hand.
//
// A gate that dirties the tree it is checking teaches people to run `git status` and ignore what it
// says, which is the same cost as a false failure. Cleaning on every catchable path is worth doing
// and does not close the case; the directory being ignored is what closes it, because it holds for
// SIGKILL too — nothing can run a handler there.

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");
const PROBE_DIRNAME = ".doc-probes";

/** Whether git ignores `path`, asked of git rather than by parsing `.gitignore` ourselves. */
function isIgnored(path) {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("the doc-api gate's probe directory", () => {
  it("is ignored wherever it lands, so an interrupted run cannot dirty the tree", () => {
    for (const root of ["packages/gateway", "packages/gateway-line", "tools", "."]) {
      const probe = join(root, PROBE_DIRNAME, "probe-0.ts");
      expect(isIgnored(probe), `${probe} is not ignored`).toBe(true);
    }
  });

  it("leaves git clean even when a run is killed mid-flight", () => {
    // The case no cleanup handler covers. Simulated by creating what an interrupted run leaves.
    const dir = join(ROOT, "packages/gateway", PROBE_DIRNAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "probe-0.ts"), "export {};\n");
    try {
      const status = execFileSync("git", ["status", "--porcelain"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      expect(status.includes(PROBE_DIRNAME), `git reports ${PROBE_DIRNAME}:\n${status}`).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the gate itself", () => {
  it("leaves nothing behind when it cannot invoke tsc", () => {
    // The path `try`/`finally` does NOT cover: `process.exit()` does not unwind the stack, so a
    // `finally` never runs. The commit that added the `finally` deleted the `rmSync` that stood
    // before this exit, and reintroduced on this one path the defect it was fixing — which shipped
    // because neither test here ran the gate at all.
    //
    // Reproduced by giving the gate a PATH with git and node but no npx, so `execFileSync` throws
    // with no numeric `status` — the branch that exits 2.
    const bin = mkdtempSync(join(tmpdir(), "no-npx-"));
    for (const tool of ["git", "node"]) {
      execFileSync("ln", [
        "-s",
        execFileSync("command", ["-v", tool], { encoding: "utf8", shell: true }).trim(),
        join(bin, tool),
      ]);
    }

    let exitCode = 0;
    try {
      execFileSync("node", ["tools/check-doc-api-drift.mjs"], {
        cwd: ROOT,
        env: { ...process.env, PATH: bin },
        stdio: "pipe",
      });
    } catch (error) {
      exitCode = error.status;
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }

    expect(exitCode, "the gate should refuse when it cannot run tsc").toBe(2);

    const leftovers = execFileSync(
      "bash",
      ["-c", `find . -name ${PROBE_DIRNAME} -not -path './node_modules/*' | wc -l`],
      { cwd: ROOT, encoding: "utf8" },
    ).trim();
    expect(leftovers, `${PROBE_DIRNAME} left behind after the refusal`).toBe("0");
  });
});
