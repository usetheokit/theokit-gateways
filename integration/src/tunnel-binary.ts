/**
 * Finding the tunnel binary that `capture:line` drives.
 *
 * This module exists because of what it REPLACED. `capture-line-user.ts` used
 * to download `cloudflared` from `releases/latest`, `chmod 755` it and execute
 * it, with the exit code of `curl` as the only control (#35) — in a repository
 * that pins its GitHub Actions by commit SHA and its actionlint image by
 * digest, and on the one machine that holds all ten platform credentials.
 *
 * The obvious fix is to pin a version and verify a SHA-256. The better one is
 * rung 1 of the parsimony ladder: the download does not need to exist. A
 * `cloudflared` installed by Homebrew or by Cloudflare's apt repository is
 * already signature-verified by that package manager — a stronger guarantee
 * than a checksum this repository would pin once and then forget to update, for
 * a script that runs about once in a project's life.
 *
 * Not fetching also retires two defects that came with fetching: the
 * `linux-amd64` asset name hard-coded on every platform, and a cached binary in
 * `.cache/` that was reused forever without revalidation.
 *
 * What remains is a question with three honest answers — an explicit override,
 * whatever is on PATH, or a clear refusal — which is what this module is.
 */

import { spawnSync } from "node:child_process";

/** The binary this module looks for when no override is given. */
const DEFAULT_BINARY = "cloudflared";

/**
 * Reports whether a candidate can actually be executed.
 *
 * Injected so the resolution policy is testable without a filesystem, a PATH,
 * or a real binary. The production implementation is {@link canExecute}.
 */
export type BinaryProbe = (candidate: string) => boolean;

export interface ResolveTunnelBinaryOptions {
  /** Explicit path from `CLOUDFLARED_PATH`, when the operator set one. */
  readonly override?: string | undefined;
  /** `process.platform`, taken as a parameter so the message is testable. */
  readonly platform: NodeJS.Platform;
  readonly probe: BinaryProbe;
}

/**
 * Raised when no runnable tunnel binary could be found.
 *
 * Typed rather than a bare `Error` so a caller can distinguish "the operator
 * has not installed cloudflared" — which is a setup instruction, not a bug —
 * from every other failure on this path (Unbreakable Rule 8).
 */
export class TunnelBinaryUnavailableError extends Error {
  readonly code = "tunnel_binary_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "TunnelBinaryUnavailableError";
  }
}

/** How to obtain cloudflared, per platform. Unknown platforms fall back to the override. */
const INSTALL_HINTS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "brew install cloudflared",
  linux:
    "install it from Cloudflare's package repository — https://pkg.cloudflare.com — " +
    "or download the release for your architecture from " +
    "https://github.com/cloudflare/cloudflared/releases and put it on PATH",
  win32: "winget install --id Cloudflare.cloudflared",
};

function installHint(platform: NodeJS.Platform): string {
  return (
    INSTALL_HINTS[platform] ??
    `install cloudflared for ${platform} and put it on PATH, or point CLOUDFLARED_PATH at it`
  );
}

/**
 * Default {@link BinaryProbe}: runs `<candidate> --version` and asks whether it worked.
 *
 * Running the binary is the honest test. Checking PATH membership or file
 * permissions answers a nearby question — an entry can exist and still be the
 * wrong architecture, which is precisely how the previous script failed on
 * macOS after downloading a Linux asset.
 */
export function canExecute(candidate: string): boolean {
  const result = spawnSync(candidate, ["--version"], { stdio: "ignore", timeout: 10_000 });
  return result.error === undefined && result.status === 0;
}

/**
 * Resolve the tunnel binary to drive, or refuse with an actionable message.
 *
 * An override wins over PATH deliberately: someone who set `CLOUDFLARED_PATH`
 * meant that binary, and silently falling back to a different one would run
 * something other than what they asked for.
 */
export function resolveTunnelBinary(opts: ResolveTunnelBinaryOptions): string {
  const override = opts.override?.trim();

  if (override !== undefined && override.length > 0) {
    if (opts.probe(override)) return override;
    throw new TunnelBinaryUnavailableError(
      `CLOUDFLARED_PATH points at "${override}", which did not run. ` +
        "Check the path, or unset the variable to use the one on PATH.",
    );
  }

  if (opts.probe(DEFAULT_BINARY)) return DEFAULT_BINARY;

  throw new TunnelBinaryUnavailableError(
    `${DEFAULT_BINARY} is not on PATH. To capture LINE_TEST_USER_ID, ${installHint(opts.platform)}.\n` +
      "\n" +
      "This script deliberately does not download it: a binary installed by your package " +
      "manager is signature-verified by it, and an unverified download executed on the machine " +
      "holding your platform credentials is the defect this replaced (#35).",
  );
}
