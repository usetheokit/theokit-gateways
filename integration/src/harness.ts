/**
 * The harness every live suite goes through.
 *
 * It exists to make one thing impossible: a suite that appears to have run
 * against a real API when it did not. Vitest reports a skipped test and a
 * passing test with the same absence of red, so the reason for a skip has to be
 * stated where a human reading CI output will see it — naming the exact
 * variable that was missing, not a vague "not configured".
 */

import { describe } from "vitest";

import { liveRunEnabled, missingFor } from "./credentials.js";
import type { PlatformSpec } from "./platforms.js";

export interface LiveSuiteOptions {
  /**
   * Whether this suite writes anywhere. Default `true`.
   *
   * A credential proves who you are; a target says where it is safe to post.
   * Suites that only authenticate or only read need the first and not the
   * second, and gating them on both keeps them dark for no reason — a token
   * alone is enough to prove the API still accepts our auth. Set `false` for
   * read-only suites, and they light up as soon as the credential exists.
   */
  readonly sends?: boolean;
}

/**
 * Declare a live suite for one platform.
 *
 * Skips, loudly and with a reason, when the run is not opted into or the
 * credentials are absent. Never silently.
 */
export function describeLive(
  spec: PlatformSpec,
  name: string,
  body: () => void,
  opts: LiveSuiteOptions = {},
): void {
  if (!liveRunEnabled()) {
    describe.skip(
      `${spec.label} — ${name} [skipped: set INTEGRATION_LIVE=1 to talk to real APIs]`,
      body,
    );
    return;
  }
  const missing = missingFor(spec, { includeTarget: opts.sends ?? true });
  if (missing.length > 0) {
    describe.skip(`${spec.label} — ${name} [skipped: missing ${missing.join(", ")}]`, body);
    return;
  }
  describe(`${spec.label} — ${name}`, body);
}

/**
 * Declare a suite that can only pass with a publicly reachable HTTPS endpoint.
 *
 * Webhook platforms cannot receive anything on a laptop: the platform dials in, so without a tunnel
 * there is no inbound to assert. Saying that out loud beats a locally-served request that proves the
 * test's own fixture works.
 *
 * It now HONOURS `INTEGRATION_PUBLIC_URL` instead of only naming it. The skip message has always
 * told the reader to set that variable, and nothing read it — `describeLiveInbound` skipped every
 * webhook platform unconditionally, so following the instruction changed nothing and the suite kept
 * reporting a remedy that did not work. A skip that misdirects is worse than one that just refuses.
 */
export function describeLiveInbound(spec: PlatformSpec, name: string, body: () => void): void {
  if (spec.transport !== "webhook") {
    describeLive(spec, name, body);
    return;
  }
  const publicUrl = process.env.INTEGRATION_PUBLIC_URL ?? "";
  if (publicUrl === "") {
    describe.skip(
      `${spec.label} — ${name} [skipped: ${spec.label} delivers inbound by webhook; set INTEGRATION_PUBLIC_URL to a tunnel that reaches this machine]`,
      body,
    );
    return;
  }
  describeLive(spec, name, body);
}

/** The public base URL a webhook platform can dial, or undefined when none is declared. */
export function publicUrl(): string | undefined {
  const value = process.env.INTEGRATION_PUBLIC_URL ?? "";
  return value === "" ? undefined : value.replace(/\/$/, "");
}

/** Poll `check` until it returns a value, or give up. Used for inbound round trips. */
export async function waitFor<T>(
  check: () => T | undefined | Promise<T | undefined>,
  opts: { timeoutMs: number; intervalMs?: number; label: string },
): Promise<T> {
  const interval = opts.intervalMs ?? 500;
  const deadline = Date.now() + opts.timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== undefined) return value;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  const suffix = last === undefined ? "" : ` — last error: ${String(last)}`;
  throw new Error(`timed out after ${opts.timeoutMs}ms waiting for ${opts.label}${suffix}`);
}
