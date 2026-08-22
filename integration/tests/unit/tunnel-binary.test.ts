/**
 * Resolving the tunnel binary — the unit that replaced an unverified download.
 *
 * `capture-line-user.ts` used to fetch `cloudflared` from `releases/latest`,
 * `chmod 755` it and run it, with the exit code of `curl` as the only control
 * (#35). Every other executable this repository depends on is pinned and
 * verified — actions by commit SHA, the actionlint image by digest — so the one
 * script that runs on a machine holding all ten platform credentials was also
 * the one with no integrity check at all.
 *
 * The fix is rung 1 of the parsimony ladder rather than rung 6: the download
 * does not need to exist. A `cloudflared` installed by the platform's own
 * package manager is already signature-verified by that package manager, which
 * is a stronger guarantee than any checksum this repository could pin and then
 * forget to update. So the script asks for the binary instead of fetching it,
 * and the whole class of defect — unverified bytes, `linux-amd64` hard-coded,
 * a cached binary nobody revalidates — disappears with it.
 */

import { describe, expect, it } from "vitest";

import { resolveTunnelBinary, TunnelBinaryUnavailableError } from "../../src/tunnel-binary.js";

/** A probe that reports the given candidates as runnable and nothing else. */
function probeFor(...runnable: string[]): (candidate: string) => boolean {
  return (candidate) => runnable.includes(candidate);
}

describe("resolveTunnelBinary", () => {
  it("returns the PATH name when cloudflared is runnable there", () => {
    const resolved = resolveTunnelBinary({
      platform: "linux",
      probe: probeFor("cloudflared"),
    });

    expect(resolved).toBe("cloudflared");
  });

  it("prefers an explicit override over the one on PATH", () => {
    // The escape hatch for a binary installed somewhere non-standard. It wins
    // deliberately: someone who set the variable meant that one.
    const resolved = resolveTunnelBinary({
      override: "/opt/cloudflared",
      platform: "linux",
      probe: probeFor("/opt/cloudflared", "cloudflared"),
    });

    expect(resolved).toBe("/opt/cloudflared");
  });

  it("rejects an override that does not execute, naming the path tried", () => {
    // Negative case: silently falling back to PATH would run a DIFFERENT binary
    // from the one the operator named, which is the surprise worth failing on.
    const act = () =>
      resolveTunnelBinary({
        override: "/opt/typo",
        platform: "linux",
        probe: probeFor("cloudflared"),
      });

    expect(act).toThrow(TunnelBinaryUnavailableError);
    expect(act).toThrow(/\/opt\/typo/);
  });

  it("fails with a typed error when nothing is runnable", () => {
    const act = () => resolveTunnelBinary({ platform: "linux", probe: probeFor() });

    expect(act).toThrow(TunnelBinaryUnavailableError);
  });

  it("carries a stable error code for callers that branch on it", () => {
    try {
      resolveTunnelBinary({ platform: "linux", probe: probeFor() });
      expect.unreachable("resolveTunnelBinary should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TunnelBinaryUnavailableError);
      expect((err as TunnelBinaryUnavailableError).code).toBe("tunnel_binary_unavailable");
    }
  });

  it("tells a macOS operator how to install it", () => {
    // Error handling (Unbreakable Rule 8): a message a human can act on without
    // a debugger. The old script hard-coded `cloudflared-linux-amd64`, so on
    // macOS it downloaded a Linux binary and failed at spawn with ENOEXEC —
    // an error that says nothing about the actual problem.
    const act = () => resolveTunnelBinary({ platform: "darwin", probe: probeFor() });

    expect(act).toThrow(/brew install cloudflared/);
  });

  it("tells a Linux operator how to install it", () => {
    const act = () => resolveTunnelBinary({ platform: "linux", probe: probeFor() });

    expect(act).toThrow(/cloudflare\.com/);
  });

  it("still names the variable to set on a platform it has no recipe for", () => {
    // Edge case: an unknown platform must not produce an empty instruction. The
    // override is always a valid answer, so it is what the fallback offers.
    const act = () => resolveTunnelBinary({ platform: "sunos", probe: probeFor() });

    expect(act).toThrow(/CLOUDFLARED_PATH/);
  });

  it("treats a blank override as absent rather than as a path", () => {
    // `CLOUDFLARED_PATH=` in a .env file reaches the process as "", and probing
    // an empty string is a question with no meaning.
    const resolved = resolveTunnelBinary({
      override: "   ",
      platform: "linux",
      probe: probeFor("cloudflared"),
    });

    expect(resolved).toBe("cloudflared");
  });
});
