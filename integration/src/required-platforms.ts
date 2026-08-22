/**
 * Which platforms a live run is REQUIRED to exercise.
 *
 * `describeLive` skips a suite whose credentials are absent, and that is the
 * right default — a missing credential is a gap in configuration, not a failing
 * platform contract. The problem is what a skip looks like from outside:
 * `Integration (live)` gates release (`release.yml` → `live-contracts`), and a
 * skipped suite is as green as a passing one. A secret that gets deleted,
 * renamed, or emptied therefore turns its platform off and lets a publish
 * through on a signal that verified nothing.
 *
 * An EXPIRED credential is already handled: the positive `connect()` test runs
 * and fails loudly. This module closes the other half — the credential that
 * stops being PRESENT.
 *
 * Opt-in via `INTEGRATION_REQUIRE_PLATFORMS`, because only the environment
 * knows what it should have: a laptop with two credentials is working as
 * intended, while CI holds a known set and can say so.
 */

/** One platform's readiness, as the report computes it. */
export interface ReadinessRow {
  readonly id: string;
  /** Environment variable names that are absent. Empty means ready. */
  readonly missing: readonly string[];
}

/** Placeholder recorded when a required platform produced no readiness row at all. */
const NO_ROW = "<no readiness row>";

/** Raised when a required id matches no registered platform. */
export class UnknownPlatformError extends Error {
  readonly code = "unknown_required_platform";

  constructor(message: string) {
    super(message);
    this.name = "UnknownPlatformError";
  }
}

/**
 * Parse `INTEGRATION_REQUIRE_PLATFORMS` into canonical platform ids.
 *
 * Unset or blank yields an empty list, which requires nothing — the local
 * default, and what keeps this from breaking a laptop that has two credentials.
 *
 * An unknown id is refused rather than ignored. Skipping it would make a typo
 * indistinguishable from a satisfied requirement: `slak` matches no platform,
 * so nothing would ever report it missing and the gate would read green while
 * guarding something that does not exist.
 */
export function parseRequiredPlatforms(
  raw: string | undefined,
  known: readonly string[],
): readonly string[] {
  if (raw === undefined) return [];

  const requested = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  const canonical: string[] = [];
  for (const id of requested) {
    if (!known.includes(id)) {
      throw new UnknownPlatformError(
        `INTEGRATION_REQUIRE_PLATFORMS names "${id}", which is not a registered platform. ` +
          `Known ids: ${known.join(", ")}.`,
      );
    }
    if (!canonical.includes(id)) canonical.push(id);
  }
  return canonical;
}

/**
 * Which required platforms are not ready, in the order they were declared.
 *
 * A required platform with no readiness row is reported too. Treating an absent
 * row as satisfied would reintroduce exactly the silence this module exists to
 * remove.
 */
export function findUnmetRequirements(
  required: readonly string[],
  readiness: readonly ReadinessRow[],
): readonly ReadinessRow[] {
  const unmet: ReadinessRow[] = [];
  for (const id of required) {
    const row = readiness.find((candidate) => candidate.id === id);
    if (row === undefined) {
      unmet.push({ id, missing: [NO_ROW] });
      continue;
    }
    if (row.missing.length > 0) unmet.push(row);
  }
  return unmet;
}
