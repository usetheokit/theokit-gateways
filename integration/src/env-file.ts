/**
 * Persisting one provisioned value into `integration/.env`.
 *
 * Four scripts in this package grew their own `upsertEnv`, and they had already
 * drifted: the copy in `capture-line-user.ts` ran the file through
 * `filter(l => l.trim() !== "")`, so adding one variable silently deleted every
 * blank line separating the operator's sections. Reformatting a file you were
 * asked to append to is a side effect nobody asked for, and it is the kind of
 * thing that goes unnoticed because `.env` is gitignored — nothing diffs it.
 *
 * This is the tested version, wired into `capture-line-user.ts`. The three
 * bootstrap scripts still carry their own copies; they are untested
 * provisioning paths and migrating them is a separate change with its own
 * verification, not a drive-by edit.
 */

import { readFileSync, writeFileSync } from "node:fs";

/** POSIX environment variable name: letters, digits, underscore; not starting with a digit. */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Insert or replace `key=value` in a `.env` file, leaving every other line untouched.
 *
 * Validates its own inputs rather than trusting the caller: this is the
 * function that turns a string into a line of a config file, so a newline in
 * the value would inject a second variable. `decideCapture` already rejects
 * such values upstream — enforcing it here too means a future caller cannot
 * reintroduce the hole by forgetting (defence in depth, `rules/error-handling.md` § 2).
 */
export function upsertEnvVar(path: string, key: string, value: string): void {
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new Error(
      `refusing to write an invalid environment variable key: ${JSON.stringify(key)}`,
    );
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`refusing to write a value containing a newline for ${key}`);
  }

  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // First write — the file is created below.
  }

  const lines = text.split("\n");
  // A trailing "\n" splits into a final empty element. Drop it so appending is
  // uniform, then restore exactly one at the end.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const line = `${key}=${value}`;
  const index = lines.findIndex((existing) => existing.trimStart().startsWith(`${key}=`));
  if (index >= 0) lines[index] = line;
  else lines.push(line);

  writeFileSync(path, `${lines.join("\n")}\n`);
}
