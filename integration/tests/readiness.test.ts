/**
 * Readiness report — which platforms can actually be exercised right now.
 *
 * This is the one suite that always runs, with or without credentials. It does
 * not talk to any API; it answers the question you ask before a live run: "what
 * is wired up, and what is each missing?"
 *
 * It exists because the honest state of a live suite is otherwise invisible. Ten
 * platforms with nine skipped and one green reads, at a glance, exactly like ten
 * platforms passing. Printing the gap turns that glance into information.
 */

import { describe, expect, it } from "vitest";

import { has, liveRunEnabled, missingFor } from "../src/credentials.js";
import { PLATFORMS, type PlatformSpec } from "../src/platforms.js";
import { findUnmetRequirements, parseRequiredPlatforms } from "../src/required-platforms.js";

/** The lines describing one platform: its status, then each gap and how to close it. */
function describeRow(spec: PlatformSpec, missing: readonly string[]): string[] {
  const mark = missing.length === 0 ? "ready  " : "missing";
  const lines = [`  [${mark}] ${spec.label.padEnd(26)} (${spec.transport})`];
  const docs = [...spec.credentials, ...spec.target];
  for (const name of missing) {
    const doc = docs.find((c) => c.name === name);
    lines.push(`             ${name} — ${doc?.what ?? ""}`);
    if (doc !== undefined) lines.push(`             ↳ ${doc.where}`);
  }
  if (missing.length > 0 && spec.caveat !== undefined) {
    lines.push(`             ⚠ ${spec.caveat}`);
  }
  return lines;
}

describe("live-test readiness", () => {
  it("reports what is configured, and what each missing platform still needs", () => {
    const rows = PLATFORMS.map((spec) => {
      const missing = missingFor(spec);
      return { spec, missing, ready: missing.length === 0 };
    });

    const ready = rows.filter((r) => r.ready).length;
    const lines = [
      "",
      `Live run enabled (INTEGRATION_LIVE): ${liveRunEnabled() ? "yes" : "NO — suites will skip"}`,
      `Platforms ready: ${ready}/${rows.length}`,
      "",
      ...rows.flatMap((row) => describeRow(row.spec, row.missing)),
      "",
    ];
    process.stdout.write(`${lines.join("\n")}\n`);

    // The report is the point; the assertion only guards the report itself.
    expect(rows.length).toBe(PLATFORMS.length);
  });

  it("fails when a platform this environment declares as required is not configured", () => {
    // The gap #32 was reaching for, though not the one it described. A skip is
    // as green as a pass, and `Integration (live)` gates release — so a secret
    // that is deleted, renamed or emptied silently turns its platform off and
    // lets a publish through on a signal that verified nothing.
    //
    // Expired credentials never had this problem: the positive connect() test
    // runs and fails. This covers the credential that stops being PRESENT.
    //
    // Opt-in, because only the environment knows what it should hold. Unset —
    // the local default — requires nothing and this assertion is a no-op.
    const required = parseRequiredPlatforms(
      process.env.INTEGRATION_REQUIRE_PLATFORMS,
      PLATFORMS.map((p) => p.id),
    );
    const unmet = findUnmetRequirements(
      required,
      PLATFORMS.map((spec) => ({ id: spec.id, missing: missingFor(spec) })),
    );

    expect(
      unmet,
      unmet.length === 0
        ? ""
        : `INTEGRATION_REQUIRE_PLATFORMS demands these platforms, and they are not configured:\n${unmet
            .map((row) => `  ${row.id} — missing ${row.missing.join(", ")}`)
            .join("\n")}\nEither restore the credentials or stop requiring the platform.`,
    ).toEqual([]);
  });

  it("never reads a credential VALUE into the report", () => {
    // A readiness report that printed values would leak every secret into CI
    // logs. It may only ever answer set/not-set.
    for (const spec of PLATFORMS) {
      for (const cred of [...spec.credentials, ...spec.target]) {
        expect(typeof has(cred.name)).toBe("boolean");
      }
    }
  });

  it("gives every platform at least one credential and one target", () => {
    // A platform with no target has nowhere safe to send, and would otherwise
    // look "ready" while being untestable.
    for (const spec of PLATFORMS) {
      expect(spec.credentials.length, `${spec.id} credentials`).toBeGreaterThan(0);
      expect(spec.target.length, `${spec.id} target`).toBeGreaterThan(0);
    }
  });

  it("uses a unique environment variable name across every platform", () => {
    // Two platforms sharing a name would silently authenticate one with the
    // other's credential.
    const seen = new Map<string, string>();
    for (const spec of PLATFORMS) {
      for (const cred of [...spec.credentials, ...spec.target]) {
        const prior = seen.get(cred.name);
        expect(prior, `${cred.name} declared by both ${prior} and ${spec.id}`).toBeUndefined();
        seen.set(cred.name, spec.id);
      }
    }
  });

  it("has a test directory for every platform id, and no orphan directories", async () => {
    // Keeps the registry and the suites from drifting apart: a platform added
    // here with no suite, or a suite for a platform nobody registered.
    //
    // `unit/` is named here rather than pattern-matched. It holds the tests for
    // the pure modules under `src/` — signature policy, port parsing, binary
    // resolution, `.env` writes — which talk to no API and must run on every
    // PR, not nightly. Naming the one exception keeps the gate closed for the
    // case it exists to catch: an exception list of one is still a list, and a
    // second entry has to be argued for.
    const NON_PLATFORM_DIRS = new Set(["unit"]);

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(new URL(".", import.meta.url), { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !NON_PLATFORM_DIRS.has(name));
    const ids = PLATFORMS.map((p) => p.id);
    for (const dir of dirs) {
      expect(ids, `tests/${dir}/ has no entry in PLATFORMS`).toContain(dir);
    }
    // The other direction, which this test claimed in its name and comment and
    // did not check. Teams, WhatsApp and SMS sat in the registry with no suite
    // at all for as long as it was one-sided — three of ten platforms invisible
    // while the readiness report stayed green, which is the failure this file
    // exists to make impossible.
    //
    // A platform with no credentials still gets a suite. It then skips with the
    // variable it wants named, and "9 skipped, 1 passed" is information; a
    // missing file is absence wearing the same colour as coverage.
    for (const id of ids) {
      expect(dirs, `PLATFORMS has "${id}" but tests/${id}/ does not exist`).toContain(id);
    }
  });
  it("drives every runtime export of the core, or says in writing why not", async () => {
    // The gap this file exists for, pointed at the core instead of at a
    // platform. Measured 2026-08-22: of the ten runtime exports of
    // `@theokit/gateway`, this package drove exactly ONE — `GatewayRunner` —
    // and nothing anywhere said so. `DeliveryRouter` had never been sent
    // through a real adapter; `post_outbound` had no production caller at all
    // (#38) and so could not have been observed live even in principle.
    //
    // A symbol is covered when the live suite NAMES it. That is a weaker claim
    // than "asserts its behaviour", and it is deliberately the claim being
    // made: this gate catches an export nobody thought about, not a weak test.
    // Whether the test is any good is what the mutation checks are for.
    //
    // Comments are stripped first. A gate that greps raw source is answered by
    // prose — including, embarrassingly, by the comment explaining the gate.
    // That exact mistake was made once in this repository and caught only
    // because the check was run against a deliberately broken input.
    const NOT_DRIVEN_LIVE: Record<string, string> = {
      chunkText:
        "pure function, no I/O. The splitting it performs IS proven over the wire, by the five adapter suites that send past their platform's cap",
      chunkByGrapheme: "pure function, same reasoning as chunkText",
      defaultStrategy: "pure function: event -> agent id string. No transport can disagree with it",
      SessionRouter: "delegates to a strategy function; nothing crosses a network",
      BasePlatformAdapter:
        "abstract base — every adapter suite in this package drives a concrete subclass of it",
      HookExecutor:
        "constructed by GatewayRunner rather than by a consumer; its three fire points are each driven by tests/gateway-e2e.test.ts",
      GatewayConfigurationError:
        "raised from bad options at construction, before any transport exists to test against",
    };

    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const core = (await import("@theokit/gateway")) as Record<string, unknown>;
    const exports = Object.keys(core).filter((name) => name !== "default");
    expect(exports.length, "no runtime exports found — was the core built?").toBeGreaterThan(0);

    const here = new URL(".", import.meta.url).pathname;
    const entries = await readdir(here, { recursive: true, withFileTypes: true });
    const sources: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      sources.push(await readFile(join(entry.parentPath, entry.name), "utf8"));
    }
    const code = sources
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    const undriven = exports.filter(
      (name) => NOT_DRIVEN_LIVE[name] === undefined && !new RegExp(`\\b${name}\\b`).test(code),
    );
    expect(
      undriven,
      undriven.length === 0
        ? ""
        : `these core exports have no live coverage and no recorded reason:\n${undriven
            .map((n) => `  ${n}`)
            .join(
              "\n",
            )}\nDrive them from tests/gateway-e2e.test.ts, or add them to NOT_DRIVEN_LIVE with why.`,
    ).toEqual([]);

    // The other direction, which the sibling directory check learned to make:
    // an exemption for a symbol that no longer exists is a reason nobody can
    // check, sitting where a reader will read it as current.
    const stale = Object.keys(NOT_DRIVEN_LIVE).filter((name) => !exports.includes(name));
    expect(
      stale,
      `NOT_DRIVEN_LIVE names exports the core no longer has: ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
