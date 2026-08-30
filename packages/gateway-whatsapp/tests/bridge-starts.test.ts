/**
 * Does the web bridge survive its own startup, and report failures in its own protocol?
 *
 * Every other test in this package injects `spawnFactory` and drives a `FakeChild`, which
 * is right for testing the IPC protocol and useless for testing the bridge. The script
 * itself had never been executed by anything — not a test, not CI, not the live suite,
 * which excludes the web backend by declaration. So a defect in its first fifteen lines
 * could survive a green suite indefinitely, and did: `LocalAuth` came back `undefined` and
 * the process died with a `TypeError` 1011 ms in (B-002).
 *
 * **What these tests assert, and what they deliberately do not.** Reaching a QR code needs
 * a browser this repository never downloads — `package.json` omits `puppeteer` from
 * `pnpm.onlyBuiltDependencies`, so its postinstall never runs. A correct bridge therefore
 * still exits non-zero here, reporting that it cannot find Chrome. Asserting liveness would
 * mark a correct fix as failed, so the assertion is on the SHAPE of the failure: the bridge
 * either keeps running or exits having emitted `{"event":"error"}` on stdout, and never
 * dies with an unhandled `TypeError`.
 *
 * That distinction is the whole of the fix. A bridge that reports its problem is one the
 * parent can map to a `SendResult`; a bridge that crashes leaves the backend waiting for a
 * 120-second connect timeout with nothing to say.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const BRIDGE = join(import.meta.dirname, "..", "src", "bridge", "whatsapp-web-bridge.mjs");

let scratch: string | undefined;

/**
 * A directory to run the bridge from.
 *
 * `LocalAuth` resolves its session path against the CURRENT WORKING DIRECTORY
 * (`whatsapp-web.js/src/authStrategies/LocalAuth.js:25`), so spawning from the package
 * would drop an untracked `.wwebjs_auth/` into it — the same shape as the probe leak fixed
 * in #40.
 */
function scratchDir(): string {
  scratch = mkdtempSync(join(tmpdir(), "wa-bridge-"));
  return scratch;
}

afterEach(() => {
  // Retried because a grandchild that escaped the process group can create a file between the
  // walk and the rmdir, and that is an ENOTEMPTY no `force` flag covers.
  if (scratch !== undefined)
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  scratch = undefined;
});

/** Is the optional peer dependency actually installed here? */
function whatsAppWebInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve("whatsapp-web.js");
    return true;
  } catch {
    return false;
  }
}

interface BridgeRun {
  readonly alive: boolean;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the bridge from `cwd` for `ms`, then report how it went. */
async function runBridge(cwd: string, ms: number, specifier?: string): Promise<BridgeRun> {
  const argv = [BRIDGE, "--session", "vitest-start-check"];
  if (specifier !== undefined) argv.push("--specifier", specifier);
  const child = spawn(process.execPath, argv, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c: Buffer) => {
    stdout += c.toString("utf8");
  });
  child.stderr.on("data", (c: Buffer) => {
    stderr += c.toString("utf8");
  });

  // `close` rather than `exit`: `exit` fires when the process ends, which can be BEFORE the
  // last stdout chunks have been delivered to this process. Reading stdout at that moment
  // can miss the very line being asserted on, and the test then fails intermittently while
  // the bridge did exactly the right thing. `close` fires once every stdio stream is done.
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });

  const alive = code === null;
  if (alive) {
    // SIGTERM, not SIGKILL, and then WAIT. The bridge closes Chromium on SIGTERM under its own
    // deadline; SIGKILL cannot be caught, so it orphans the whole browser tree, and the orphans
    // keep writing leveldb into the scratch directory `afterEach` is removing — an ENOTEMPTY that
    // only ever surfaced under a full-suite run.
    //
    // Firing a signal is not the same as the process being gone: this is the lesson the
    // `close`-over-`exit` choice above already records, applied to the path that lacked it.
    child.kill("SIGTERM");
    const closed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 8_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    // Only if the bridge ignored its own deadline. The dedicated SIGTERM test above is what
    // notices when that becomes the normal path rather than the fallback.
    if (!closed) child.kill("SIGKILL");
  }
  return { alive, code, stdout, stderr };
}

/** The structured events the bridge wrote to stdout, in order. */
function eventsFrom(stdout: string): Array<{ event: string; message?: string; code?: string }> {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as { event: string; message?: string; code?: string }];
      } catch {
        return [];
      }
    });
}

describe("the web bridge script", () => {
  it("never dies with an unhandled TypeError during startup", async (ctx) => {
    // The defect B-002 records. The bridge read `LocalAuth` off the module namespace, but
    // whatsapp-web.js ends its `module.exports` object with a spread, which defeats
    // cjs-module-lexer — so only some names are synthesised, and `LocalAuth` was not among
    // them. The `try/catch` around the import guards against the package being ABSENT, not
    // against a member being undefined, so the failure escaped it entirely.
    // Skipping is not passing. A bare `return` reports green having asserted nothing, which
    // is the "9 skipped, 1 passed reads like ten passing" problem one directory over.
    ctx.skip(!whatsAppWebInstalled(), "whatsapp-web.js (optional peer) is not installed here");

    const { alive, code, stdout, stderr } = await runBridge(scratchDir(), 2_500);

    expect(
      stderr,
      `the bridge crashed instead of reporting:\n${stderr.split("\n").slice(0, 10).join("\n")}`,
    ).not.toContain("is not a constructor");

    // Either it is still running, or it stopped having said why in its own protocol.
    const reported = eventsFrom(stdout).some((e) => e.event === "error");
    expect(
      alive || reported,
      `the bridge exited ${code} with no structured error on stdout. stdout=${JSON.stringify(stdout)} stderr=${stderr.slice(0, 400)}`,
    ).toBe(true);
  }, 20_000);

  it("resolves the API when a name lives only on the default export", async () => {
    // THE test for D315, and the one the first round of this suite did not have.
    //
    // A reviewer reverted D315 alone and the whole suite stayed green: D316, shipped in the
    // same commit, converted the crash into a structured error that the other tests accept.
    // The suite protected the error message and not the fix.
    //
    // This stub carries the REAL shape that produced B-002 — `Client` reachable on the
    // namespace, `LocalAuth` only on the default, exactly what cjs-module-lexer leaves of
    // whatsapp-web.js. Namespace destructuring yields `LocalAuth === undefined` and the
    // bridge reports `peer_incompatible`; reading the default resolves both and startup
    // proceeds to its real obstacle, the missing browser.
    const dir = scratchDir();
    const stub = join(dir, "real-shape.mjs");
    writeFileSync(
      stub,
      [
        "export function Client() { return { on() {}, initialize() { return Promise.reject(new Error('no browser')); } }; }",
        "function LocalAuth() {}",
        "export default { Client, LocalAuth };",
        "",
      ].join("\n"),
    );

    const { stdout } = await runBridge(dir, 2_500, stub);

    const errors = eventsFrom(stdout).filter((e) => e.event === "error");
    // If resolution regressed, the capability check fires and names a binding. Getting past
    // it is the only thing this asserts — and the only thing that distinguishes D315 from
    // D316.
    expect(
      errors.filter((e) => e.code === "peer_incompatible"),
      `resolution regressed — the API was not read off the default export: ${JSON.stringify(errors)}`,
    ).toEqual([]);
  }, 20_000);

  it("names the missing binding when the package is present but does not expose it", async () => {
    // The negative case (rules/testing.md § 4.1): assert the SPECIFIC typed error, not that
    // it merely failed. A stub package stands in for a future version that moves the name,
    // so the test needs no real dependency and no browser.
    const dir = scratchDir();
    const stub = join(dir, "stub-whatsapp-web.mjs");
    writeFileSync(
      stub,
      // Client present, LocalAuth absent — exactly the shape that produced B-002.
      "export default { Client: function Client() {} };\n",
    );

    const { stdout, stderr } = await runBridge(dir, 2_500, stub);

    const errors = eventsFrom(stdout).filter((e) => e.event === "error");
    expect(
      errors.length,
      `expected a structured error, got stdout=${JSON.stringify(stdout)} stderr=${stderr.slice(0, 300)}`,
    ).toBeGreaterThan(0);
    expect(errors[0]?.message ?? "").toContain("LocalAuth");
    expect(errors[0]?.code, "the error carries no machine-readable cause").toBe(
      "peer_incompatible",
    );
    expect(stderr).not.toContain("is not a constructor");
  }, 20_000);

  it("still reports an absent package as absent, not as a missing binding", async () => {
    // The pre-existing failure mode must survive the fix. "Not installed" and "installed
    // but different" are two problems, and telling a consumer the wrong one sends them to
    // run `pnpm add` for a package they already have.
    const dir = scratchDir();

    const { stdout } = await runBridge(dir, 2_500, join(dir, "does-not-exist.mjs"));

    const errors = eventsFrom(stdout).filter((e) => e.event === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message ?? "").toContain("not installed");
    expect(errors[0]?.code).toBe("peer_missing");
  }, 20_000);

  it("exits on SIGTERM instead of hanging with Chromium still alive", async (ctx) => {
    // Measured 2026-08-30: SIGTERM did not terminate the bridge at all — `exit` never fired, and
    // eleven Chromium processes stayed up. puppeteer installs its own SIGTERM handler by default,
    // which replaces Node's terminate-on-signal and then waits on a browser close that can never
    // arrive while WhatsApp Web is still loading. The bridge installed no handler of its own, so
    // it inherited that behaviour.
    //
    // The consequence is not confined to tests: any supervisor — systemd, Docker, pm2, a parent
    // Node process — stops a child with SIGTERM. Every such stop left a hung bridge and a leaked
    // browser tree, and only SIGKILL got out of it, which cannot close anything cleanly.
    ctx.skip(!whatsAppWebInstalled(), "whatsapp-web.js (optional peer) is not installed here");

    const dir = scratchDir();
    const child = spawn(process.execPath, [BRIDGE, "--session", "vitest-sigterm"], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.on("data", () => undefined);
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });

    // Attached NOW, not after the wait below. The first version registered it just before
    // signalling, and on a runner with no browser to launch the bridge exits on its own within
    // seconds — so the listener arrived after the event and then waited twenty seconds for
    // something that had already happened. The test reported "ignored SIGTERM" about a process
    // that had been dead the whole time.
    let died = false;
    child.once("exit", () => {
      died = true;
    });

    // WAIT FOR THE STATE, do not guess at how long it takes to reach.
    //
    // The first version slept six seconds, which is what launching Chromium costs on the machine
    // this was written on and nothing like what it costs on a shared CI runner — the test failed
    // there on its first run. A fixed sleep calibrated on one machine is a timing assumption
    // wearing a test's clothes.
    //
    // The QR line is the real signal: the bridge writes it once the browser is up AND WhatsApp Web
    // has rendered the login page, which is precisely the state the hang was measured in. Polling
    // for it is bounded, and reaching the bound is not a pass — a bridge that never got there must
    // still die on SIGTERM, so the run continues and the message says which state it was in.
    const deadline = Date.now() + 45_000;
    while (!stderr.includes("Scan this QR") && !died && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // A bridge that died before it could be signalled cannot answer the question this test asks,
    // and pretending otherwise would report a pass or a failure about an event that never
    // occurred. It happens on a runner where puppeteer has no browser to launch. Say so.
    ctx.skip(
      died,
      `the bridge exited before it could be signalled — no browser in this environment: ${stderr.trim().slice(-200)}`,
    );

    const browserWasUp = stderr.includes("Scan this QR");

    const exited = await new Promise<boolean>((resolve) => {
      // Generous against the bridge's OWN deadline, which is five seconds: `shutdown()` races
      // `client.destroy()` against a timer and exits either way. Twenty seconds is four times
      // that, and before the fix this never resolved true at any length — `exit` did not fire at
      // all. Widening it cannot turn a broken shutdown into a passing test.
      const timer = setTimeout(() => resolve(false), 20_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
      child.kill("SIGTERM");
    });

    if (!exited) child.kill("SIGKILL");
    expect(
      exited,
      `the bridge ignored SIGTERM and had to be killed (browser up: ${browserWasUp})`,
    ).toBe(true);
  }, 90_000);

  it("leaves no session directory in the package it was spawned from", async (ctx) => {
    // LocalAuth writes `.wwebjs_auth/` relative to cwd. Running the bridge from the package
    // would leave one behind, untracked and invisible until someone runs `git add -A`.
    ctx.skip(!whatsAppWebInstalled(), "whatsapp-web.js (optional peer) is not installed here");

    await runBridge(scratchDir(), 2_500);

    expect(existsSync(join(import.meta.dirname, "..", ".wwebjs_auth"))).toBe(false);
  }, 20_000);
});
