/**
 * Writing one variable into `integration/.env`.
 *
 * Extracted from `capture-line-user.ts` because it is the step where a captured
 * value becomes persistent state, and it was the only copy of four in this
 * package that silently DELETED every blank line in the operator's `.env` on
 * its way past (`filter(l => l.trim() !== "")`). Reformatting a file you were
 * asked to add one line to is a side effect nobody consented to.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { upsertEnvVar } from "../../src/env-file.js";

/** A throwaway .env, seeded with the given content. */
function envFileWith(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "theokit-envfile-"));
  const path = join(dir, ".env");
  if (content !== undefined) writeFileSync(path, content);
  return path;
}

describe("upsertEnvVar", () => {
  it("creates the file when it does not exist yet", () => {
    const path = join(mkdtempSync(join(tmpdir(), "theokit-envfile-")), ".env");

    upsertEnvVar(path, "LINE_TEST_USER_ID", "Uabc");

    expect(readFileSync(path, "utf8")).toBe("LINE_TEST_USER_ID=Uabc\n");
  });

  it("appends a new variable, keeping what was already there", () => {
    const path = envFileWith("INTEGRATION_LIVE=1\n");

    upsertEnvVar(path, "LINE_TEST_USER_ID", "Uabc");

    expect(readFileSync(path, "utf8")).toBe("INTEGRATION_LIVE=1\nLINE_TEST_USER_ID=Uabc\n");
  });

  it("replaces an existing value in place rather than appending a duplicate", () => {
    // Two lines for one key is ambiguous: which one wins depends on the parser.
    const path = envFileWith("A=1\nLINE_TEST_USER_ID=Uold\nB=2\n");

    upsertEnvVar(path, "LINE_TEST_USER_ID", "Unew");

    expect(readFileSync(path, "utf8")).toBe("A=1\nLINE_TEST_USER_ID=Unew\nB=2\n");
  });

  it("preserves blank lines and comments", () => {
    // The regression this module exists for.
    const path = envFileWith("# Telegram\nTELEGRAM_BOT_TOKEN=x\n\n# LINE\nLINE_CHANNEL_SECRET=y\n");

    upsertEnvVar(path, "LINE_TEST_USER_ID", "Uabc");

    expect(readFileSync(path, "utf8")).toBe(
      "# Telegram\nTELEGRAM_BOT_TOKEN=x\n\n# LINE\nLINE_CHANNEL_SECRET=y\nLINE_TEST_USER_ID=Uabc\n",
    );
  });

  it("does not match a key that merely shares a prefix", () => {
    // `LINE_TEST_USER` must not be mistaken for `LINE_TEST_USER_ID`. The
    // original used startsWith(`${key}=`), which is correct here — this pins it.
    const path = envFileWith("LINE_TEST_USER_ID_EXTRA=keep\n");

    upsertEnvVar(path, "LINE_TEST_USER_ID", "Uabc");

    expect(readFileSync(path, "utf8")).toBe(
      "LINE_TEST_USER_ID_EXTRA=keep\nLINE_TEST_USER_ID=Uabc\n",
    );
  });

  it("adds the missing trailing newline before appending", () => {
    const path = envFileWith("A=1");

    upsertEnvVar(path, "B", "2");

    expect(readFileSync(path, "utf8")).toBe("A=1\nB=2\n");
  });

  it("refuses a value containing a newline", () => {
    // Defence in depth. decideCapture already rejects these, but this function
    // is what turns a string into a line of a config file, so it enforces the
    // invariant itself rather than trusting its caller.
    const path = envFileWith("A=1\n");

    expect(() => upsertEnvVar(path, "B", "two\nC=3")).toThrow(/newline/i);
    expect(readFileSync(path, "utf8")).toBe("A=1\n");
  });

  it("refuses a key that is not a valid environment variable name", () => {
    const path = envFileWith("A=1\n");

    expect(() => upsertEnvVar(path, "not a key", "x")).toThrow(/key/i);
    expect(readFileSync(path, "utf8")).toBe("A=1\n");
  });
});
