import { describe, expect, it } from "vitest";

import { citedIds, registeredIds, unregisteredCitations } from "../lib/adr-citations.mjs";

// Every `D###` a published declaration cites should resolve to something a reader can open.
//
// Measured for B-015: 76 distinct ids across the eleven published `.d.ts`, and 59 of them resolved
// nowhere. They were not deleted — they were defined in implementation plans under `.claude/`,
// which is development tooling and is not versioned. So the citations reached npm while the
// documents defining them stayed on one machine.
//
// The registry records the lost ones AS lost rather than deleting the citations, because a reader
// who meets `D412` in a docblock is better served by "not recoverable" than by silence — and
// deleting them would destroy the only evidence the decisions were ever made.

describe("adr citations", () => {
  it("finds the ids a declaration cites", () => {
    const dts = "/** per ADR D426 and D170. */\nexport declare const a: string;\n";
    expect(citedIds(dts)).toEqual(["D170", "D426"]);
  });

  it("does not read a longer identifier as an id", () => {
    expect(citedIds("D1234 and XD170 and D17")).toEqual([]);
  });

  it("reads the registry's rows, whatever their status", () => {
    const md =
      "| `D170` | recorded | a decision | `gateway` | src |\n| `D412` | **lost** | — | `gateway` | — |\n";
    expect(registeredIds(md)).toEqual(["D170", "D412"]);
  });

  it("reports a citation with no row", () => {
    const registry = "| `D170` | recorded | x | y | z |\n";
    const files = new Map([["packages/gateway/dist/index.d.ts", "/** D170 and D999. */"]]);
    expect(unregisteredCitations(files, registry)).toEqual([
      { id: "D999", file: "packages/gateway/dist/index.d.ts" },
    ]);
  });

  it("accepts a lost row — the gate asks for accounted-for, not for a decision to be invented", () => {
    const registry = "| `D999` | **lost** | — | `gateway` | — |\n";
    const files = new Map([["packages/gateway/dist/index.d.ts", "/** D999. */"]]);
    expect(unregisteredCitations(files, registry)).toEqual([]);
  });

  it("scans every declaration, not just the first", () => {
    // A `unregisteredCitations` that examined only the first entry of the Map passed the whole
    // suite, because every other case here builds a single-entry Map. Eleven declarations are
    // scanned in practice, and the second one carrying the only unaccounted id is the realistic
    // shape of the failure.
    const files = new Map([
      ["packages/gateway/dist/index.d.ts", "/** D170. */"],
      ["packages/gateway-slack/dist/index.d.ts", "/** D999. */"],
    ]);
    expect(unregisteredCitations(files, "| `D170` | recorded | x | y | z |\n")).toEqual([
      { id: "D999", file: "packages/gateway-slack/dist/index.d.ts" },
    ]);
  });

  it("does not register an id that appears in a row's decision text", () => {
    // The anchor and the backticks are what stop a `D###` written in prose from counting as a row.
    // Both survived mutation until this existed, and loosening either would let a citation account
    // for itself by being mentioned.
    const registry = "| `D170` | recorded | superseded by D999, see below | `gateway` | src |\n";
    expect(registeredIds(registry)).toEqual(["D170"]);
  });

  it("does not register a row whose id is not in backticks", () => {
    // The registry's format uses backticks, so a row without them is malformed. Failing closed on
    // one is right: a table someone hand-edited into a shape the parser half-reads would silently
    // account for citations nobody reviewed.
    expect(registeredIds("| D170 | recorded | x | y | z |\n")).toEqual([]);
  });

  it("names a repeated citation once", () => {
    // A declaration citing the same id twice is ordinary — two docblocks referring to one decision.
    // Reporting it twice would make the gate's output count occurrences rather than problems.
    const files = new Map([["a.d.ts", "/** D901 here. */\n/** and D901 again. */"]]);
    expect(unregisteredCitations(files, "")).toEqual([{ id: "D901", file: "a.d.ts" }]);
  });

  it("reports every unregistered citation, not just the first", () => {
    const files = new Map([["a.d.ts", "D901 D902"]]);
    expect(unregisteredCitations(files, "").map((c) => c.id)).toEqual(["D901", "D902"]);
  });
});
