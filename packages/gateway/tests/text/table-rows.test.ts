import { describe, expect, it } from "vitest";

import { channelRendering } from "../../src/index.js";
import { type Dialect, toDialect } from "../../src/text/dialect.js";
import type { PlatformName } from "../../src/types/message-event.js";

/**
 * B-556 FR-001 to FR-003, AC-001, AC-002: a Markdown table row keeps its cells through
 * translation. Before this, one regex pass over the whole reply let an emphasis marker open in one
 * cell and close in the next, so `| 2 x *a | b* y |` lost both stars on the ten platforms that
 * rewrite markers.
 */

const PLATFORMS = [
  "whatsapp",
  "slack",
  "discord",
  "mattermost",
  "teams",
  "signal",
  "line",
  "sms",
  "telegram",
  "matrix",
  "email",
  "imessage",
  "google_chat",
  "irc",
  "nextcloud_talk",
] as const satisfies readonly PlatformName[];

const STRIPPING: readonly PlatformName[] = [
  "line",
  "sms",
  "telegram",
  "matrix",
  "email",
  "imessage",
  "google_chat",
  "irc",
];
const SINGLE_CHARACTER: readonly PlatformName[] = ["whatsapp", "slack"];
const IDENTITY: readonly PlatformName[] = [
  "discord",
  "mattermost",
  "teams",
  "signal",
  "nextcloud_talk",
];

const STRIP: Dialect = {};
const WHATSAPP: Dialect = { bold: "*", italic: "_", strike: "~", code: "```" };
const SLACK: Dialect = { bold: "*", italic: "_", strike: "~", code: "`" };

/** The dialect each platform's `translate` applies; `undefined` passes the text through. */
function dialectOf(platform: PlatformName): Dialect | undefined {
  if (platform === "whatsapp") return WHATSAPP;
  if (platform === "slack") return SLACK;
  return STRIPPING.includes(platform) ? STRIP : undefined;
}

// `rewriteMarkers` as it was at 688c322: one replace over the whole text. Kept here as the
// reference the new function must equal wherever no span crosses a table row's pipe.
const PATTERN_AT_688C322 =
  /\*\*(?<bold>.+?)\*\*|~~(?<strike>.+?)~~|(?<![*\w])\*(?!\s)(?<italicStar>.+?)(?<!\s)\*(?!\*)|(?<![_\w])_(?!\s)(?<italicUnderscore>.+?)(?<!\s)_(?!\w)|`(?<code>.+?)`/gu;
const GROUPS_AT_688C322 = [
  ["bold", "bold"],
  ["strike", "strike"],
  ["italicStar", "italic"],
  ["italicUnderscore", "italic"],
  ["code", "code"],
] as const;

function markerAt688c322(
  matched: string,
  groups: Record<string, string | undefined>,
  dialect: Dialect,
): string {
  for (const [group, marker] of GROUPS_AT_688C322) {
    const content = groups[group];
    if (content === undefined) continue;
    const wrap = dialect[marker];
    return wrap === undefined ? content : `${wrap}${content}${wrap}`;
  }
  return matched;
}

function rewriteAt688c322(text: string, dialect: Dialect): string {
  return text.replace(PATTERN_AT_688C322, (matched, ...args) =>
    markerAt688c322(matched, args.at(-1) as Record<string, string | undefined>, dialect),
  );
}

function translateAt688c322(platform: PlatformName, text: string): string {
  const dialect = dialectOf(platform);
  return dialect === undefined ? text : rewriteAt688c322(text, dialect);
}

/** Splits a row at unescaped pipes, keeping each pipe as its own element. */
function cellsOf(row: string): string[] {
  const out: string[] = [];
  let from = 0;
  let slashes = 0;
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (ch === "\\") {
      slashes += 1;
      continue;
    }
    if (ch === "|" && slashes % 2 === 0) {
      out.push(row.slice(from, i), "|");
      from = i + 1;
    }
    slashes = 0;
  }
  out.push(row.slice(from));
  return out;
}

const rewriteCells = (row: string, rewrite: (cell: string) => string): string =>
  cellsOf(row)
    .map((cell) => (cell === "|" ? cell : rewrite(cell)))
    .join("");

const ROW = /^[^\S\r\n]*\|/;

/** The reference: every row cell by cell, every other line with the 688c322 replace. */
function referenceRewrite(text: string, dialect: Dialect): string {
  return text
    .split(/(\r\n|\r|\n)/)
    .map((piece) =>
      ROW.test(piece)
        ? rewriteCells(piece, (cell) => rewriteAt688c322(cell, dialect))
        : rewriteAt688c322(piece, dialect),
    )
    .join("");
}

const pipeCount = (s: string): number => s.split("|").length - 1;
const rowsOf = (t: string): string[] => t.split(/\r\n|\r|\n/).filter((l) => ROW.test(l));

const HEADER_B = "| id | bold | code | math | ident | strike |";
const SEP_B = "|---|---|---|---|---|---|";
const markerRow = (i: number): string =>
  i % 3 === 2
    ? `| ${i} x *a | b* y | _c | d_ | 2*3 | 4*5 |`
    : `| ${i} | **b${i}** | \`c${i}\` | 2*3*4 | snake_case_name | ~~s${i}~~ |`;
const HEADER_A = "| id | name | value | note |";
const SEP_A = "|---|:---:|---:|---|";
const plainRow = (i: number): string =>
  `| ${i} | item-${i} | ${1000 + i} | plain text cell number ${i} |`;
const sparseRow = (i: number): string =>
  i % 50 === 0
    ? `| ${i} | **item-${i}** | ${1000 + i} | plain text cell number ${i} |`
    : plainRow(i);

/** A table of at least `minLength` characters, its length summed as it grows (no rejoin per row). */
function tableOf(header: string, sep: string, row: (i: number) => string, minLength: number) {
  const lines = [header, sep];
  let length = header.length + 1 + sep.length;
  for (let i = 0; length < minLength; i += 1) {
    const next = row(i);
    lines.push(next);
    length += next.length + 1;
  }
  return lines.join("\n");
}

function proseWithPipes(minLength: number): string {
  const lines: string[] = [];
  let length = 0;
  for (let i = 0; length < minLength; i += 1) {
    const next = `Paragraph ${i}: some **bold** and _it_ text with \`code\` and a | pipe.\n\n`;
    lines.push(next);
    length += next.length;
  }
  return lines.join("");
}

const wrap = (t: string): string => `Here is the table.\n\n${t}\n\nThat is all.`;
const translate = (platform: PlatformName) => channelRendering(platform).translate;

describe("table rows through translate", () => {
  const markerTable = wrap(tableOf(HEADER_B, SEP_B, markerRow, 400));

  it("rewrites every row of the marker table cell by cell on all 15 platforms", () => {
    const perCellMismatches: string[] = [];
    for (const p of PLATFORMS) {
      const tr = translate(p);
      const out = rowsOf(tr(markerTable));
      rowsOf(markerTable).forEach((row, k) => {
        if (out[k] !== rewriteCells(row, tr)) perCellMismatches.push(`${p}: ${row}`);
      });
    }
    expect(perCellMismatches).toEqual([]);
  });

  it("keeps a bold span that crosses a pipe in its two cells on whatsapp", () => {
    const row = "| **a | b** |";
    expect(translate("whatsapp")(row)).toBe(row);
  });

  it("leaves a cross-cell row unchanged on telegram and whatsapp", () => {
    const row = "| 2 x *a | b* y | _c | d_ |";
    expect(translate("telegram")(row)).toBe(row);
    expect(translate("whatsapp")(row)).toBe(row);
  });

  it("reads a span crossing an escaped pipe as one cell", () => {
    const row = "| *x \\| y* |";
    for (const p of STRIPPING) expect(translate(p)(row)).toBe("| x \\| y |");
    for (const p of SINGLE_CHARACTER) expect(translate(p)(row)).toBe("| _x \\| y_ |");
    for (const p of IDENTITY) expect(translate(p)(row)).toBe(row);
  });

  it("keeps the pipe count of every row on all 15 platforms", () => {
    for (const p of PLATFORMS) {
      const out = rowsOf(translate(p)(markerTable));
      expect(out.map(pipeCount)).toEqual(rowsOf(markerTable).map(pipeCount));
    }
  });

  it("gives the same rows through toDialect as through translate for whatsapp, line and sms", () => {
    for (const p of ["whatsapp", "line", "sms"] as const) {
      expect(toDialect(markerTable, p)).toBe(translate(p)(markerTable));
    }
  });

  it("translates prose with a mid-sentence pipe exactly as at 688c322 (FR-002)", () => {
    const prose = "a *x | y* b";
    for (const p of PLATFORMS) expect(translate(p)(prose)).toBe(translateAt688c322(p, prose));
  });

  it("translates a multi-line reply with no pipe byte-identically to 688c322 (FR-002)", () => {
    const reply = "Hello **there**.\nSome _italic_ and ~~gone~~.\n\nA `code` span and *more*.\n";
    for (const p of PLATFORMS) expect(translate(p)(reply)).toBe(translateAt688c322(p, reply));
  });

  it("rewrites every cell of a CRLF table and keeps every CRLF", () => {
    const table = "| **a** | *b | c* |\r\n| `d` | e |\r\n";
    expect(translate("telegram")(table)).toBe("| a | *b | c* |\r\n| d | e |\r\n");
  });

  it("round-trips mixed line endings with no marker on all 15 platforms", () => {
    const text = "| a | b |\r\n| c | d |\rplain line\n| e |\r\n";
    for (const p of PLATFORMS) expect(translate(p)(text)).toBe(text);
  });

  it("treats a lone CR before a row as a line ending (panel round 3)", () => {
    const text = "intro\r| x *a | b* y |";
    expect(translate("telegram")(text)).toBe(text);
  });

  it("treats a lone CR after a row as a line ending, so the prose after it is prose", () => {
    expect(translate("telegram")("| h |\rprose *a | b*")).toBe("| h |\rprose a | b");
    expect(translate("telegram")("| x *a | b* y |\rprose *a | b*")).toBe(
      "| x *a | b* y |\rprose a | b",
    );
  });

  it("rewrites a row whose only markers are backticks cell by cell", () => {
    expect(translate("telegram")("| `a` | x `b | c` y |")).toBe("| a | x `b | c` y |");
  });

  it("splits inline code at an unescaped pipe inside a cell, as GFM does (EC-1)", () => {
    const row = "| run `a|b` here |";
    for (const p of PLATFORMS) {
      const tr = translate(p);
      expect(tr(row)).toBe(rewriteCells(row, tr));
    }
    expect(translate("telegram")(row)).toBe(row);
  });
});

const MILLION = 1_000_000;
type BigFixture = "plain" | "sparse" | "crossing" | "prose";
let builtFixtures: Readonly<Record<BigFixture, string>> | undefined;

/** The four 1,000,000-character fixtures, built on first use so a filtered run skips them. */
function bigFixtures(): Readonly<Record<BigFixture, string>> {
  builtFixtures ??= {
    plain: tableOf(HEADER_A, SEP_A, plainRow, MILLION),
    sparse: tableOf(HEADER_A, SEP_A, sparseRow, MILLION),
    crossing: tableOf(HEADER_B, SEP_B, markerRow, MILLION),
    prose: proseWithPipes(MILLION),
  };
  return builtFixtures;
}
// One line with no newline and a pipe-holding match every four characters: a line-start lookup
// that scans back from each match would be quadratic here (pre-RED consultation, T1.1).
const longLine = (): string => "*|* ".repeat(MILLION / 4);

/** The reference for each distinct dialect, computed once: eight platforms share STRIP. */
function referencesFor(dialect: Dialect, cache: Map<Dialect, Record<string, string>>) {
  const known = cache.get(dialect);
  if (known !== undefined) return known;
  const computed = Object.fromEntries(
    Object.entries(bigFixtures()).map(([name, text]) => [name, referenceRewrite(text, dialect)]),
  );
  cache.set(dialect, computed);
  return computed;
}

/** Each platform/fixture pair on which translate differs from the reference. */
function lineMismatchesOf(): string[] {
  const cache = new Map<Dialect, Record<string, string>>();
  const mismatches: string[] = [];
  for (const p of PLATFORMS) {
    const dialect = dialectOf(p);
    const expected: Readonly<Record<string, string>> =
      dialect === undefined ? bigFixtures() : referencesFor(dialect, cache);
    for (const [name, text] of Object.entries(bigFixtures())) {
      if (translate(p)(text) !== expected[name]) mismatches.push(`${p}/${name}`);
    }
  }
  return mismatches;
}

describe("rewriteMarkers on 1,000,000-character fixtures", () => {
  it("equals the cell-by-cell reference on all 15 platforms and every fixture", {
    timeout: 120_000,
  }, () => {
    const lineMismatches = lineMismatchesOf();
    expect(lineMismatches).toEqual([]);
  });

  // Each translate call costs seconds on this line (the 688c322 replace alone measured about 4 s at
  // load 60), so it runs once per distinct dialect rather than on all 15 platforms.
  it("equals the reference on one long line full of pipe-holding matches", {
    timeout: 120_000,
  }, () => {
    const text = longLine();
    for (const p of ["telegram", "whatsapp", "slack"] as const) {
      const dialect = dialectOf(p) ?? STRIP;
      expect(translate(p)(text) === referenceRewrite(text, dialect)).toBe(true);
    }
  });
});

/** Mean time of one call of `fn`, repeating it until `budgetMs` has passed. */
function timePerCall(fn: () => unknown, budgetMs: number): number {
  let calls = 0;
  const start = performance.now();
  do {
    fn();
    calls += 1;
  } while (performance.now() - start < budgetMs);
  return (performance.now() - start) / calls;
}

/** Median of `pairs` interleaved ratios new / old, so both functions see the same load. */
function medianRatio(oldFn: () => unknown, newFn: () => unknown, pairs: number): number {
  const ratios: number[] = [];
  oldFn();
  newFn();
  for (let k = 0; k < pairs; k += 1) {
    const old = timePerCall(oldFn, 500);
    ratios.push(timePerCall(newFn, 500) / old);
  }
  ratios.sort((x, y) => x - y);
  return ratios[Math.floor(pairs / 2)] ?? Number.POSITIVE_INFINITY;
}

describe("rewriteMarkers timing against the 688c322 replace", () => {
  const BOUNDS = [
    ["plain", 3],
    ["sparse", 3],
    ["prose", 3],
    ["crossing", 8],
  ] as const;
  for (const platform of ["telegram", "whatsapp"] as const) {
    for (const [name, bound] of BOUNDS) {
      it(`stays within ${bound}x on the ${name} fixture for ${platform}`, {
        timeout: 120_000,
      }, () => {
        const text = bigFixtures()[name];
        const dialect = dialectOf(platform) ?? STRIP;
        const tr = translate(platform);
        const ratio = medianRatio(
          () => rewriteAt688c322(text, dialect),
          () => tr(text),
          5,
        );
        expect(ratio).toBeLessThanOrEqual(bound);
      });
    }
  }
});
