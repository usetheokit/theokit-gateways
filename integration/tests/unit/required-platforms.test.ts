/**
 * Declaring which platforms MUST be configured for a live run to mean anything.
 *
 * `describeLive` skips a suite whose credentials are absent, which is right: a
 * missing credential is not a failing contract. But `Integration (live)` gates
 * release (`release.yml` → `live-contracts`), and a skip is green. So a secret
 * that is deleted, renamed, or silently emptied turns its platform's suite off
 * and lets a publish through on a signal that tested nothing — the failure the
 * README already names ("9 skipped, 1 passed reads like ten platforms passing")
 * without anything enforcing it.
 *
 * An EXPIRED credential does not have this problem: the positive `connect()`
 * test runs and fails loudly. This closes the other half — the credential that
 * stops being present at all.
 *
 * Opt-in through `INTEGRATION_REQUIRE_PLATFORMS`, so a laptop with two
 * credentials keeps working unchanged and CI, which knows what it should have,
 * states it.
 *
 * Context: #32 reported email/telegram/matrix credentials as rejected, reading
 * the `connect failed` lines that the NEGATIVE tests emit on purpose. The
 * credentials were valid. This is the gap that report was reaching for.
 */

import { describe, expect, it } from "vitest";

import {
  findUnmetRequirements,
  parseRequiredPlatforms,
  UnknownPlatformError,
} from "../../src/required-platforms.js";

const KNOWN = ["telegram", "discord", "slack", "matrix"] as const;

describe("parseRequiredPlatforms", () => {
  it("returns nothing when the variable is unset — the local default", () => {
    expect(parseRequiredPlatforms(undefined, KNOWN)).toEqual([]);
  });

  it("returns nothing for an empty or whitespace-only value", () => {
    expect(parseRequiredPlatforms("", KNOWN)).toEqual([]);
    expect(parseRequiredPlatforms("   ", KNOWN)).toEqual([]);
  });

  it("parses a comma-separated list", () => {
    expect(parseRequiredPlatforms("telegram,discord", KNOWN)).toEqual(["telegram", "discord"]);
  });

  it("tolerates spacing and trailing separators", () => {
    expect(parseRequiredPlatforms(" telegram , discord , ", KNOWN)).toEqual([
      "telegram",
      "discord",
    ]);
  });

  it("de-duplicates without changing the order", () => {
    expect(parseRequiredPlatforms("discord,telegram,discord", KNOWN)).toEqual([
      "discord",
      "telegram",
    ]);
  });

  it("refuses an id no platform declares", () => {
    // A typo would otherwise be indistinguishable from a satisfied requirement:
    // "slak" matches nothing, so nothing reports it missing, and the gate reads
    // green while guarding a platform that does not exist.
    expect(() => parseRequiredPlatforms("telegram,slak", KNOWN)).toThrow(UnknownPlatformError);
    expect(() => parseRequiredPlatforms("telegram,slak", KNOWN)).toThrow(/slak/);
  });

  it("names the known ids when it refuses, so the fix needs no source dive", () => {
    expect(() => parseRequiredPlatforms("nope", KNOWN)).toThrow(/telegram/);
  });

  it("is case-insensitive on input but reports canonical ids", () => {
    expect(parseRequiredPlatforms("TELEGRAM, Discord", KNOWN)).toEqual(["telegram", "discord"]);
  });
});

describe("findUnmetRequirements", () => {
  it("reports nothing when every required platform is ready", () => {
    const unmet = findUnmetRequirements(
      ["telegram", "discord"],
      [
        { id: "telegram", missing: [] },
        { id: "discord", missing: [] },
        { id: "slack", missing: ["SLACK_BOT_TOKEN"] },
      ],
    );

    expect(unmet).toEqual([]);
  });

  it("reports a required platform whose credentials are absent, with the variable names", () => {
    const unmet = findUnmetRequirements(
      ["telegram", "slack"],
      [
        { id: "telegram", missing: [] },
        { id: "slack", missing: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"] },
      ],
    );

    expect(unmet).toEqual([{ id: "slack", missing: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"] }]);
  });

  it("does not report platforms nobody required", () => {
    // The opt-in property: an unlisted platform may skip freely.
    const unmet = findUnmetRequirements([], [{ id: "slack", missing: ["SLACK_BOT_TOKEN"] }]);

    expect(unmet).toEqual([]);
  });

  it("reports a required platform that produced no readiness row at all", () => {
    // Edge case: required id valid against the registry, but absent from the
    // rows handed in. Silently treating that as satisfied is the failure mode
    // this whole module exists to prevent.
    const unmet = findUnmetRequirements(["matrix"], [{ id: "telegram", missing: [] }]);

    expect(unmet).toEqual([{ id: "matrix", missing: ["<no readiness row>"] }]);
  });

  it("preserves the declared order so the message is stable across runs", () => {
    const unmet = findUnmetRequirements(
      ["slack", "matrix"],
      [
        { id: "matrix", missing: ["MATRIX_ACCESS_TOKEN"] },
        { id: "slack", missing: ["SLACK_BOT_TOKEN"] },
      ],
    );

    expect(unmet.map((u) => u.id)).toEqual(["slack", "matrix"]);
  });
});
