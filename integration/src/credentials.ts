/**
 * Credential resolution for the live suites.
 *
 * Two sources, one shape:
 *
 * - Locally, `integration/.env` — untracked, `.gitignore` covers `.env` and `.env.*`.
 * - In CI, repository secrets mapped into `env:` on the job. Same variable
 *   names, so a suite never knows or cares which one it got.
 *
 * There is deliberately no fallback, no default and no "example" value. A test
 * that quietly runs against a placeholder proves nothing and takes a green tick
 * with it, which is the failure mode this whole package exists to avoid: when a
 * credential is missing the suite SKIPS, and says exactly which variable is
 * missing and where to get it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PlatformSpec } from "./platforms.js";

/** Values are never logged. Only variable NAMES ever reach test output. */
let loaded: Record<string, string> | undefined;

/**
 * Parse `KEY=value` lines. Ignores blanks and `#` comments, strips one layer of
 * matching quotes. Values already present in `process.env` win, so CI secrets
 * are never shadowed by a stray local file.
 */
/** Strip one layer of matching quotes, if present. */
function unquote(value: string): string {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return quoted ? value.slice(1, -1) : value;
}

/** `KEY=value`, or undefined for a blank line, a comment, or a line with no key. */
function parseEnvLine(rawLine: string): readonly [string, string] | undefined {
  const line = rawLine.trim();
  if (line.length === 0 || line.startsWith("#")) return undefined;
  const eq = line.indexOf("=");
  if (eq <= 0) return undefined;
  return [line.slice(0, eq).trim(), unquote(line.slice(eq + 1).trim())];
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const entry = parseEnvLine(rawLine);
    if (entry !== undefined) out[entry[0]] = entry[1];
  }
  return out;
}

function env(): Record<string, string> {
  if (loaded !== undefined) return loaded;
  let fromFile: Record<string, string> = {};
  try {
    fromFile = parseEnvFile(readFileSync(join(import.meta.dirname, "..", ".env"), "utf8"));
  } catch {
    // No local .env is the normal case in CI.
  }
  const merged: Record<string, string> = { ...fromFile };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v.length > 0) merged[k] = v;
  }
  loaded = merged;
  return merged;
}

/** A variable is "set" only if it is present AND non-empty. */
export function has(name: string): boolean {
  const v = env()[name];
  return v !== undefined && v.trim().length > 0;
}

/**
 * Read a required variable. Throws rather than returning a placeholder — by the
 * time a suite calls this, {@link missingFor} has already decided it should run.
 */
export function required(name: string): string {
  const v = env()[name];
  if (v === undefined || v.trim().length === 0) {
    throw new Error(`missing credential ${name} — this suite should have been skipped`);
  }
  return v.trim();
}

export function optional(name: string): string | undefined {
  const v = env()[name];
  return v === undefined || v.trim().length === 0 ? undefined : v.trim();
}

/**
 * Names of the variables this platform needs and does not have.
 *
 * `includeTarget` exists because the two kinds answer different questions. A
 * credential says who we are; a target says where it is safe to write. A suite
 * that only authenticates needs the first and not the second, and demanding
 * both would keep it dark while the thing it tests is perfectly reachable.
 */
export function missingFor(spec: PlatformSpec, opts: { includeTarget?: boolean } = {}): string[] {
  const vars =
    opts.includeTarget === false ? spec.credentials : [...spec.credentials, ...spec.target];
  return vars.map((c) => c.name).filter((n) => !has(n));
}

/**
 * The variables this platform still needs when SOME of them are set, or none when all or none are.
 *
 * A half-configured platform is a mistake to report, not a reason to skip: a skip reads as "nothing
 * to run here" and hides the variable someone forgot (EC-19).
 *
 * @param isSet whether a variable is set; defaults to {@link has}
 */
export function incompleteFor(
  spec: PlatformSpec,
  isSet: (name: string) => boolean = has,
): string[] {
  const names = [...spec.credentials, ...spec.target].map((c) => c.name);
  const missing = names.filter((name) => !isSet(name));
  return missing.length === names.length ? [] : missing;
}

/** Live suites are opt-in: they send real messages and cost real money. */
export function liveRunEnabled(): boolean {
  return has("INTEGRATION_LIVE") && required("INTEGRATION_LIVE") !== "0";
}

/**
 * A short marker put into every message these tests send, so anything that
 * escapes into a real conversation is identifiable as test traffic at a glance,
 * and so a test can recognise its own message when it comes back around.
 */
export function runMarker(): string {
  return `theokit-integration-${process.env.GITHUB_RUN_ID ?? "local"}-${Math.random().toString(36).slice(2, 8)}`;
}
