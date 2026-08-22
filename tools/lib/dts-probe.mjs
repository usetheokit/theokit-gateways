// Probe files for the DTS repair (#29) and their cleanup contract (#40).
//
// The repair cannot read a declaration and decide where a name comes from; it asks the compiler, by
// writing a one-line `.ts` inside the package and compiling it. That file is scratch space, and
// scratch space that survives its question stops being scratch: a probe was found in
// `packages/gateway-whatsapp/` at the start of an audit, left by a process that no longer existed,
// untracked and one `git add -A` away from being published in a public repository.
//
// It survived because the delete sat AFTER the compile step rather than in a `finally`, and the
// compile step could end the run. Two guarantees are needed, and they are different: the probe goes
// away however the question ended (`withProbe`), and probes from a run that was killed outright —
// where no JavaScript gets to run at all — are cleared before the next one starts
// (`sweepStaleProbes`). Neither subsumes the other.

import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Filename prefix that marks a file as repair scratch space. Also matched by `.gitignore`. */
export const PROBE_PREFIX = ".dts-probe-";

/**
 * Write a probe into `pkgDir`, hand its path to `run`, and delete it — whatever `run` does.
 *
 * `id` only has to be unique within the process; the PID separates concurrent runs.
 *
 * @param {string} pkgDir Package directory the probe must resolve modules from.
 * @param {number|string} id Per-process discriminator for the filename.
 * @param {string} source Contents of the probe.
 * @param {(probePath: string) => T} run Question to ask while the probe exists.
 * @returns {T} Whatever `run` returned.
 * @template T
 */
export function withProbe(pkgDir, id, source, run) {
  const probe = join(pkgDir, `${PROBE_PREFIX}${process.pid}-${id}.ts`);
  writeFileSync(probe, source);
  try {
    return run(probe);
  } finally {
    rmSync(probe, { force: true });
  }
}

/**
 * Delete probes left in `pkgDir` by an earlier run, and report how many.
 *
 * Recovers the one case `withProbe` cannot: a signal or a `SIGKILL`, where no `finally` runs. A
 * missing directory is reported as zero rather than thrown — the sweep runs before the work, so a
 * package that is not there is the caller's diagnostic to make, not a crash inside the cleanup.
 *
 * @param {string} pkgDir
 * @returns {number} Probes removed.
 */
export function sweepStaleProbes(pkgDir) {
  if (!existsSync(pkgDir)) return 0;
  let removed = 0;
  for (const name of readdirSync(pkgDir)) {
    if (!name.startsWith(PROBE_PREFIX)) continue;
    rmSync(join(pkgDir, name), { force: true });
    removed += 1;
  }
  return removed;
}
