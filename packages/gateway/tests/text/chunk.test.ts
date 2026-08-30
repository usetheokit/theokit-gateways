/**
 * Golden tests for `chunkText` (roadmap M0, step 2).
 *
 * The strongest guarantee we can give M1 (which migrates 4 adapters onto
 * `chunkText`) is that `chunkText`, configured per family, reproduces the
 * ORIGINAL adapter algorithms byte-for-byte. So this file embeds verbatim
 * copies of the pre-migration `splitForSlack` / `splitForWhatsApp` /
 * `splitForTeams` / `splitForDiscord` implementations as reference oracles and
 * asserts equality across a deterministic corpus. If these pass, the M1
 * wrappers are guaranteed identical output.
 */

import { describe, expect, it } from "vitest";

import { chunkText } from "../../src/text/chunk.js";

// ---------------------------------------------------------------------------
// Reference oracles — verbatim copies of the pre-M1 adapter split functions.
// ---------------------------------------------------------------------------

/** Slack-family cut point (verbatim logic; MAX-parametrized to de-dup the 3 copies). */
function oracleFindCutPointA(remaining: string, max: number): number {
  let cut = remaining.lastIndexOf("\n\n", max);
  if (cut < max * 0.5) cut = remaining.lastIndexOf("\n", max);
  if (cut < max * 0.5) cut = remaining.lastIndexOf(" ", max);
  if (cut <= 0) cut = max;
  if (cut < remaining.length) {
    const code = remaining.charCodeAt(cut);
    if (code >= 0xdc00 && code <= 0xdfff) cut -= 1;
  }
  return cut <= 0 ? max : cut;
}

/** Slack-family loop; `trimParts` reproduces the WhatsApp/Teams end-trim variant. */
function oracleFamilyA(text: string, max: number, trimParts: boolean): string[] {
  if (text.length <= max) {
    if (!trimParts) return [text];
    const single = text.trim();
    return single.length > 0 ? [single] : [];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    const cut = oracleFindCutPointA(remaining, max);
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^[\s]+/, "");
  }
  if (remaining.length > 0) chunks.push(remaining);
  return trimParts ? chunks.map((p) => p.trim()).filter((p) => p.length > 0) : chunks;
}

const oracleSlack = (text: string): string[] => oracleFamilyA(text, 4000, false);
const oracleWhatsApp = (text: string): string[] => oracleFamilyA(text, 4096, true);
const oracleTeams = (text: string): string[] => oracleFamilyA(text, 8000, true);

function oracleDiscord(text: string): string[] {
  const MAX = 2000;
  const SAFE = 1900;
  if (text.length <= MAX) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= SAFE) {
      parts.push(remaining);
      break;
    }
    let boundary = remaining.lastIndexOf("\n\n", SAFE);
    if (boundary < SAFE / 2) boundary = remaining.lastIndexOf("\n", SAFE);
    if (boundary < SAFE / 2) boundary = SAFE;
    parts.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).replace(/^\n+/, "");
  }
  return parts;
}

// ---------------------------------------------------------------------------
// chunkText configured per family — must match the oracle exactly.
// ---------------------------------------------------------------------------

const slackViaCore = (t: string) =>
  chunkText(t, {
    limit: 4000,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
  });

const whatsappViaCore = (t: string) =>
  chunkText(t, {
    limit: 4096,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
    trimParts: true,
  });

const teamsViaCore = (t: string) =>
  chunkText(t, {
    limit: 8000,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
    trimParts: true,
  });

const discordViaCore = (t: string) =>
  chunkText(t, {
    limit: 2000,
    safeLimit: 1900,
    boundaries: ["\n\n", "\n"],
    lastResort: "window",
    stripLeading: /^\n+/,
  });

// ---------------------------------------------------------------------------
// Deterministic corpus generator (no Math.random — reproducible).
// ---------------------------------------------------------------------------

function makeCorpus(): string[] {
  const corpus: string[] = ["", "short", "   leading and trailing   ", "line1\nline2\n\npara2"];
  // Long strings with paragraph/line/space structure around each family's window.
  const word = "lorem ipsum dolor sit amet ";
  const para = `${word.repeat(20)}\n\n`;
  for (const size of [
    1899, 1900, 1901, 2000, 2001, 3999, 4000, 4001, 4096, 4097, 8000, 8001, 12000,
  ]) {
    // Space-separated words (exercises " " boundary + tail).
    let spaced = "";
    while (spaced.length < size) spaced += word;
    corpus.push(spaced.slice(0, size));
    // Paragraph-structured (exercises \n\n / \n boundaries).
    let paras = "";
    while (paras.length < size) paras += para;
    corpus.push(paras.slice(0, size));
    // A block with no breakable boundary at all (forces window fallback).
    corpus.push("x".repeat(size));
  }
  // Emoji at the window edge to exercise the surrogate guard (😀 = 2 UTF-16 units).
  corpus.push(`${"a".repeat(3999)}😀${"b".repeat(200)}`);
  corpus.push(`${"a".repeat(4095)}😀${"b".repeat(200)}`);
  // Emoji at the Discord (1900) window edge — pins that Discord has NO surrogate guard.
  corpus.push(`${"a".repeat(1899)}😀${"b".repeat(200)}`);
  // Non-\n/non-space whitespace in the strip position — distinguishes /^\s+/ from /^\n+/.
  corpus.push(`${"x".repeat(3990)} \t\r\f${"y".repeat(500)}`);
  // A boundary that exists but sits BEFORE half the window, with none after it. This is the only
  // shape that separates `lastResort: "last-boundary"` from `"window"`: with a boundary at index 2
  // and nothing later, last-boundary cuts at 2 and window cuts at the limit. Every other corpus
  // entry has either a usable boundary or none at all, so both modes agreed on all of them and the
  // branch that chooses between them was never observed — mutation testing found it alive.
  corpus.push(`ab ${"x".repeat(5000)}`);
  corpus.push(`ab\n${"x".repeat(5000)}`);
  corpus.push(`ab\n\n${"x".repeat(5000)}`);
  // A tail that VANISHES once stripLeading runs: the cut lands exactly where the trailing whitespace
  // begins, so the remainder is stripped to "". Every other entry leaves something after the last
  // cut, so the `length > 0` guards before the final push were never observed — mutating them to
  // `>= 0` appends an empty chunk and nothing noticed.
  corpus.push(`${"x".repeat(4000)}\n\n\n`);
  corpus.push(`${"x".repeat(4096)}\n\n`);
  corpus.push(`${"x".repeat(1900)}\n\n`);
  // A boundary sitting EXACTLY on the half-window acceptance threshold (`cut >= window * 0.5`), with
  // a weaker boundary further along. Only this shape separates `>=` from `>`: at 2000 the newline is
  // accepted and the search stops, while one unit either side the answer is the same under both.
  corpus.push(`${"a".repeat(2000)}\n${"b".repeat(999)} ${"c".repeat(2000)}`);
  // A remainder of EXACTLY the window after the first cut, splittable. `while (remaining > safe)` and
  // `>=` agree on every other entry: with no boundary left they both stop, and with nothing left the
  // extra pass emits nothing. Here the leftover is exactly 4000 AND has a space at its midpoint, so
  // the off-by-one costs a real chunk.
  corpus.push(`${"x".repeat(4000)}${"a".repeat(2000)} ${"b".repeat(1999)}`);
  // A boundary at exactly half of DISCORD's 1900 window. The half-window test is `cut < window*0.5`,
  // and the entry above pins the sibling comparison inside searchBoundary; this one pins the caller.
  // It has to be Discord: the families whose lastResort is "last-boundary" keep the same cut either
  // way, so the off-by-one is only observable where the fallback is the window itself.
  corpus.push(`${"a".repeat(950)}\n${"b".repeat(2000)}`);
  return corpus;
}

const CORPUS = makeCorpus();

describe("chunkText — single-chunk fast path", () => {
  it("returns the text unchanged when under the limit", () => {
    expect(chunkText("hello", { limit: 100 })).toEqual(["hello"]);
  });
  it("returns empty string as a single chunk by default", () => {
    expect(chunkText("", { limit: 100 })).toEqual([""]);
  });

  it("splits on the documented defaults when only a limit is given", () => {
    // Justified by a gap, not by a wish for another test: every other case here passes an explicit
    // `boundaries` / `stripLeading` / `lastResort`, and the one call that omits them ("hello", under
    // the limit) returns on the fast path before any of them is read. So the DEFAULTS on the
    // splitting path had no coverage at all, and mutation testing said so — six mutants survived
    // across the two default declarations, meaning the documented contract could be changed to
    // anything and every test would still pass.
    //
    // `boundaries = ["\n\n", "\n", " "]`: with a space inside the window, the cut takes it rather
    // than slicing mid-word.
    const words = `${"a".repeat(30)} ${"b".repeat(30)}`;
    expect(chunkText(words, { limit: 40 })).toEqual(["a".repeat(30), ` ${"b".repeat(30)}`]);

    // `stripLeading = /^\n+/`: newlines that begin a continuation chunk are dropped, and other
    // leading whitespace is NOT — a default of /^\s+/ would eat the space and fail here.
    const lines = `${"a".repeat(30)}\n\n ${"b".repeat(20)}`;
    expect(chunkText(lines, { limit: 32 })).toEqual(["a".repeat(30), ` ${"b".repeat(20)}`]);

    // ...and it is ANCHORED. Above, the newlines happen to sit at the head of the continuation, so
    // an unanchored /\n+/ would strip the same characters and look identical. Here the cut lands on
    // a space and the newline is further in, where only the anchor keeps it: an unanchored pattern
    // deletes a line break from the middle of the user's message.
    const inner = `${"a".repeat(30)} ${"b".repeat(30)}\n${"c".repeat(5)}`;
    expect(chunkText(inner, { limit: 40 })).toEqual([
      "a".repeat(30),
      ` ${"b".repeat(30)}\n${"c".repeat(5)}`,
    ]);

    // `lastResort = "window"`: with no boundary anywhere, the cut falls on the window rather than
    // on the last (failed) boundary search, so chunks come out exactly `limit` long.
    expect(chunkText("x".repeat(25), { limit: 10 })).toEqual([
      "x".repeat(10),
      "x".repeat(10),
      "xxxxx",
    ]);
  });
  it("drops an all-whitespace single chunk when trimParts is set", () => {
    expect(chunkText("   ", { limit: 100, trimParts: true })).toEqual([]);
  });
});

describe("chunkText — input validation (fail fast)", () => {
  // The message is asserted, not just the type. `rules/error-handling.md` § 2 requires a typed error
  // WITH enough context to act on, and `limit` and `safeLimit` raise the SAME RangeError from the
  // same helper — the label is the only thing telling a caller which of the two they got wrong.
  it("throws on non-positive limit instead of hanging", () => {
    expect(() => chunkText("abc", { limit: 0 })).toThrow(
      /^chunkText: limit must be a positive integer, received 0$/,
    );
    expect(() => chunkText("abc", { limit: -5 })).toThrow(/positive integer/);
    expect(() => chunkText("abc", { limit: 1.5 })).toThrow(RangeError);
  });
  it("throws when safeLimit exceeds limit (would break the hard cap)", () => {
    expect(() => chunkText("abc", { limit: 100, safeLimit: 200 })).toThrow(/safeLimit/);
  });
  it("throws on non-positive safeLimit", () => {
    expect(() => chunkText("abc", { limit: 100, safeLimit: 0 })).toThrow(
      /^chunkText: safeLimit must be a positive integer, received 0$/,
    );
  });
  it("accepts safeLimit === limit and safeLimit < limit", () => {
    expect(() => chunkText("abc", { limit: 100, safeLimit: 100 })).not.toThrow();
    expect(() => chunkText("abc", { limit: 100, safeLimit: 50 })).not.toThrow();
  });
});

describe("chunkText — every chunk respects the window", () => {
  it("Slack family: no chunk exceeds 4000", () => {
    for (const t of CORPUS) {
      for (const c of slackViaCore(t)) expect(c.length).toBeLessThanOrEqual(4000);
    }
  });
  it("Discord family: no chunk exceeds 2000", () => {
    for (const t of CORPUS) {
      for (const c of discordViaCore(t)) expect(c.length).toBeLessThanOrEqual(2000);
    }
  });
});

describe("chunkText reproduces the adapter oracles byte-for-byte", () => {
  it("Slack (4000, space, surrogate guard, last-boundary)", () => {
    for (const t of CORPUS) expect(slackViaCore(t)).toEqual(oracleSlack(t));
  });
  it("WhatsApp (4096, trimParts)", () => {
    for (const t of CORPUS) expect(whatsappViaCore(t)).toEqual(oracleWhatsApp(t));
  });
  it("Teams (8000, trimParts)", () => {
    for (const t of CORPUS) expect(teamsViaCore(t)).toEqual(oracleTeams(t));
  });
  it("Discord (2000/1900 soft window, newline-only)", () => {
    for (const t of CORPUS) expect(discordViaCore(t)).toEqual(oracleDiscord(t));
  });
});

describe("chunkText — surrogate guard", () => {
  it("never splits an astral character in the middle (Slack family)", () => {
    // Three characters, not one, and the choice is the point. `guardSurrogate` tests
    // `code >= 0xdc00 && code <= 0xdfff`, so only a low surrogate sitting ON one of those bounds can
    // tell `>=` from `>` or `<=` from `<`. 😀 is U+1F600, whose low surrogate is 0xDE00 — comfortably
    // inside the range, so it passes either way and the boundary was never exercised. U+10000 and
    // U+103FF are the two characters whose low surrogates ARE the bounds.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["\u{1F600}", "grinning face, low surrogate 0xDE00 — mid-range"],
      ["\u{10000}", "linear B syllable, low surrogate 0xDC00 — the lower bound"],
      ["\u{103FF}", "old italic letter, low surrogate 0xDFFF — the upper bound"],
    ];

    for (const [astral, why] of cases) {
      // Placed so the 4000-char window falls between the two code units of the pair.
      const text = `${"a".repeat(3999)}${astral}${"b".repeat(200)}`;
      const parts = slackViaCore(text);

      for (const c of parts) {
        const first = c.charCodeAt(0);
        const last = c.charCodeAt(c.length - 1);
        // Both ends, not just the tail: a cut severs a pair into a trailing HIGH surrogate on one
        // chunk and a leading LOW surrogate on the next, and checking one end sees half the damage.
        expect(
          last >= 0xd800 && last <= 0xdbff,
          `${why}: chunk ends on a lone high surrogate`,
        ).toBe(false);
        expect(
          first >= 0xdc00 && first <= 0xdfff,
          `${why}: chunk starts on a lone low surrogate`,
        ).toBe(false);
      }

      // The property the two checks above are proxies for: nothing was lost or altered. A guard that
      // stepped back too far, or not far enough, changes the text even when no chunk ends badly.
      expect(parts.join(""), `${why}: rejoining the chunks did not reproduce the input`).toBe(text);
    }

    // The other half of the claim, and the half that was missing: the guard must NOT fire where
    // there is nothing to protect. Every assertion above still holds for a guard that steps back
    // unconditionally — the text rejoins, no chunk ends on half a pair, and every chunk is merely
    // one unit shorter than it should be. So the window is checked on BMP-only text, where the cut
    // is exactly the window or the guard stole a character that fits.
    const plain = "a".repeat(4200);
    expect(
      slackViaCore(plain)[0]?.length,
      "the surrogate guard stepped back on text that has no surrogates",
    ).toBe(4000);

    // ASCII alone does not test the guard's UPPER bound: 'a' is below 0xDC00, so dropping the
    // `code <= 0xdfff` half changes nothing for it. Only a character ABOVE the surrogate range tells
    // the two apart, and the realistic one is fullwidth — U+FF21 is ordinary Japanese text, not an
    // exotic input, and a guard missing its ceiling would quietly shorten every chunk edge that
    // lands on one.
    const fullwidth = `${"a".repeat(4000)}${"Ａ".repeat(200)}`;
    expect(
      slackViaCore(fullwidth)[0]?.length,
      "the surrogate guard fired on U+FF21, which is above the surrogate range",
    ).toBe(4000);
  });
});
