/**
 * Whether the server a platform was provisioned against is answering right now.
 *
 * Credentials cannot answer this. For the two Docker-backed platforms the credentials are written
 * BY the bootstrap script, so finding them in `.env` proves the container was once up and says
 * nothing about now — measured 2026-08-28, when readiness reported Matrix and Mattermost `[ready]`
 * against stopped containers and the live suite spent two minutes failing 16 tests to discover it.
 *
 * Deliberately not a health check. It asks whether anything is listening, because that is the
 * distinction that was missing; a server that answers 404 at its root is up, and judging its
 * health is the live suite's job, not this one's.
 */

import { optional } from "./credentials.js";
import type { PlatformSpec } from "./platforms.js";

/** How long to wait before calling a local container absent. Generous for a loopback address. */
const TIMEOUT_MS = 2_000;

/**
 * True when nothing answered at `url`.
 *
 * Any HTTP response means reachable — status is not the question. Only a transport failure or a
 * timeout counts as unreachable, so a homeserver that refuses the request still reports as up.
 */
export async function unreachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
    return false;
  } catch {
    return true;
  }
}

/**
 * `undefined` when the platform declares no server of its own — the honest value for Telegram or
 * Slack, whose servers are somebody else's and always up. `true`/`false` only where a URL was
 * declared AND is set: an unset variable is a MISSING credential, which readiness already reports,
 * and calling it unreachable would name the same gap twice under a wronger name.
 */
export async function reachabilityOf(spec: PlatformSpec): Promise<boolean | undefined> {
  if (spec.reachableVia === undefined) return undefined;
  // `optional`, not `process.env`: this package loads `.env` itself, so the variables the rest
  // of the suite reads are not on `process.env`. Reading the wrong one made this check return
  // `undefined` for every platform — a gate that could not fire, which a green run cannot show.
  const url = optional(spec.reachableVia);
  if (url === undefined || url === "") return undefined;
  return !(await unreachable(url));
}
