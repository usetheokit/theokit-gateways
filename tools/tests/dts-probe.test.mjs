// The repair asks the compiler questions by writing a one-line `.ts` file inside the package,
// compiling it and deleting it. A probe from PID 186371 was found sitting in
// `packages/gateway-whatsapp/` at the start of an audit — untracked, uncommitted, and older than
// any process on the machine (#40). Deleting the probe on the happy path only is not a cleanup
// contract; what these tests pin is that the file is gone however the question ended.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PROBE_PREFIX, sweepStaleProbes, withProbe } from "../lib/dts-probe.mjs";

let dir;

function pkgDir(files = {}) {
  dir = mkdtempSync(join(tmpdir(), "dts-probe-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function probesIn(at) {
  return readdirSync(at).filter((name) => name.startsWith(PROBE_PREFIX));
}

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("withProbe", () => {
  it("hands the callback a path to the written probe", () => {
    const at = pkgDir();
    const seen = withProbe(at, 0, "export type _Probe = string;\n", (probe) => ({
      probe,
      exists: existsSync(probe),
      content: readFileSync(probe, "utf8"),
    }));

    expect(seen.exists).toBe(true);
    expect(seen.content).toBe("export type _Probe = string;\n");
    expect(seen.probe.startsWith(join(at, PROBE_PREFIX))).toBe(true);
  });

  it("returns what the callback returned", () => {
    const at = pkgDir();
    expect(withProbe(at, 0, "x", () => ["error TS2305"])).toEqual(["error TS2305"]);
  });

  it("removes the probe once the question is answered", () => {
    const at = pkgDir();
    withProbe(at, 0, "x", () => []);

    expect(probesIn(at)).toEqual([]);
  });

  it("removes the probe when the callback throws, and lets the error through", () => {
    // This is the case the old code missed: the compile step could terminate the run, and the
    // delete sat after it rather than in a finally, so the probe outlived the process.
    const at = pkgDir();

    expect(() =>
      withProbe(at, 0, "x", () => {
        throw new Error("tsc could not be run");
      }),
    ).toThrow("tsc could not be run");
    expect(probesIn(at)).toEqual([]);
  });

  it("gives concurrent probes distinct names so one cannot delete another's file", () => {
    const at = pkgDir();
    const first = withProbe(at, 0, "x", (probe) => probe);
    const second = withProbe(at, 1, "x", (probe) => probe);

    expect(first).not.toBe(second);
  });
});

describe("sweepStaleProbes", () => {
  it("removes probes an earlier run could not clean up", () => {
    const at = pkgDir({
      [`${PROBE_PREFIX}186371-7.ts`]: "import type { ChildProcess } from 'node:child_process';\n",
      [`${PROBE_PREFIX}4242-0.ts`]: "export type _Probe = string;\n",
    });

    expect(sweepStaleProbes(at)).toBe(2);
    expect(probesIn(at)).toEqual([]);
  });

  it("touches nothing else in the package", () => {
    const at = pkgDir({
      [`${PROBE_PREFIX}1-0.ts`]: "x",
      "package.json": "{}",
      "index.ts": "export const kept = true;\n",
    });
    sweepStaleProbes(at);

    expect(readdirSync(at).sort()).toEqual(["index.ts", "package.json"]);
  });

  it("reports zero on a clean package", () => {
    expect(sweepStaleProbes(pkgDir({ "package.json": "{}" }))).toBe(0);
  });

  it("reports zero for a directory that does not exist, rather than throwing", () => {
    // The sweep runs before the work, so a package directory that is missing has to be the
    // caller's problem to report, not an unhandled crash inside the cleanup.
    expect(sweepStaleProbes(join(pkgDir(), "no-such-package"))).toBe(0);
  });
});
