import { describe, expect, it } from "vitest";

import {
  channelRendering,
  chunkByGrapheme,
  chunkText,
  scanFences,
  toDialect,
} from "../../src/index.js";
import { rewriteMarkers } from "../../src/text/dialect.js";
import type { PlatformName } from "../../src/types/message-event.js";

/** B-518: fenced code blocks survive translation and splitting. */

const TEN = [
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "teams",
  "email",
  "sms",
  "mattermost",
  "line",
  "matrix",
] as const satisfies readonly PlatformName[];

const CODE = ["const a = **x** * 2;", "let _b_ = ~~c~~; // `d`", "", "  ```inner``` is text"];
const FENCE = ["```ts", ...CODE.slice(0, 3), "```"].join("\n");
const TILDE = ["~~~", "**not bold**", "~~~"].join("\n");

describe("scanFences", () => {
  it("finds every fenced region, backtick, tilde, longer and unclosed", () => {
    const text = `a\n${FENCE}\nb\n${TILDE}\nc\n\`\`\`\`\n\`\`\`\nstill\n\`\`\`\`\nd\n\`\`\`py\nopen`;
    const found = scanFences(text);
    expect(found.map((r) => text.slice(r.start, r.end))).toEqual([
      FENCE,
      TILDE,
      "````\n```\nstill\n````",
      "```py\nopen",
    ]);
    expect(found.map((r) => r.closed)).toEqual([true, true, true, false]);
    expect(found[0]?.opener).toBe("```ts");
    expect(found[2]?.closer).toBe("````");
  });

  it("ignores inline triple backticks and a fence indented four", () => {
    expect(scanFences("a ```b``` c\n```x`y\n    ```\n")).toEqual([]);
  });
});

describe("translation leaves a fenced block byte-identical", () => {
  const text = `**bold** before\n${FENCE}\n_after_ *it*`;
  for (const platform of TEN) {
    it(`${platform}: toDialect and channelRendering`, () => {
      expect(toDialect(text, platform)).toContain(FENCE);
      const translated = channelRendering(platform).translate(text);
      expect(translated).toContain(FENCE);
    });
  }

  it("still rewrites the text around the block", () => {
    expect(toDialect(text, "whatsapp")).toBe(`*bold* before\n${FENCE}\n_after_ _it_`);
    expect(rewriteMarkers(`${TILDE}\n**b**`, {})).toBe(`${TILDE}\nb`);
  });
});

const lines = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `code line ${i} ${"x".repeat(i % 7)}`);
const BLOCK = ["intro text", "```js", ...lines(300), "", "```", "the end"].join("\n");

const OPTIONS: Record<string, Parameters<typeof chunkText>[1]> = {
  discord: {
    limit: 2000,
    safeLimit: 1900,
    boundaries: ["\n\n", "\n"],
    lastResort: "window",
    stripLeading: /^\n+/,
    keepTableRows: true,
  },
  "discord-escaped": {
    limit: 1000,
    safeLimit: 950,
    boundaries: ["\n\n", "\n"],
    lastResort: "window",
    stripLeading: /^\n+/,
    keepTableRows: true,
  },
  mattermost: {
    limit: 700,
    safeLimit: 650,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    stripLeading: /^\s+/,
    keepTableRows: true,
  },
  slack: {
    limit: 600,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
    keepTableRows: true,
  },
  teams: {
    limit: 600,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
    trimParts: true,
    keepTableRows: true,
  },
  whatsapp: {
    limit: 600,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
    trimParts: true,
    keepTableRows: true,
  },
};

const codeLines = (parts: readonly string[]): string[] =>
  parts.flatMap((p) => p.split("\n")).filter((l) => l.startsWith("code line") || l === "");

function expectBalanced(parts: readonly string[], limit: number): void {
  expect(parts.length).toBeGreaterThan(2);
  for (const part of parts) {
    expect(part.length).toBeLessThanOrEqual(limit);
    expect(scanFences(part).every((r) => r.closed)).toBe(true);
  }
  // every part after the first that is inside the block reopens it
  for (const part of parts.slice(1, -1)) expect(part.startsWith("```js\n")).toBe(true);
  // the original code lines, in order, with no line split or lost
  const original = lines(300);
  const got = codeLines(parts).filter((l) => l !== "");
  expect(got).toEqual(original);
}

describe("chunkText closes and reopens a fence at every cut inside one", () => {
  for (const [name, options] of Object.entries(OPTIONS)) {
    it(name, () => {
      const parts = chunkText(BLOCK, options);
      expectBalanced(parts, options.limit);
      expect(parts[0]?.endsWith("\n```")).toBe(true);
    });
  }

  it("moves a cut in the opening line to before the fence", () => {
    const text = `${"p".repeat(95)}\n\`\`\`js\n${"c\n".repeat(30)}\`\`\``;
    const parts = chunkText(text, { limit: 100, boundaries: ["\n"] });
    expect(parts[0]).toBe("p".repeat(95));
    expect(parts[1]?.startsWith("```js\n")).toBe(true);
  });

  it("splits text with no fence into the chunks it was split into before", () => {
    const text = Array.from({ length: 200 }, (_, i) => `para ${i} ${"w ".repeat(i % 9)}`).join(
      "\n\n",
    );
    const o = OPTIONS.slack as Parameters<typeof chunkText>[1];
    const parts = chunkText(text, o);
    expect(parts.join("").length).toBeGreaterThan(0);
    expect(parts).toEqual(legacy(text, o));
  });
});

/** The pre-B-518 loop, for text with no fence, written out independently of chunk.ts. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a verbatim copy of the old loop, kept as an oracle
function legacy(text: string, o: Parameters<typeof chunkText>[1]): string[] {
  const limit = o.limit;
  const safe = o.safeLimit ?? limit;
  const strip = o.stripLeading ?? /^\n+/;
  const bs = o.boundaries ?? ["\n\n", "\n", " "];
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let rem = text;
  while (rem.length > safe) {
    let cut = safe;
    for (const b of bs) {
      cut = rem.lastIndexOf(b, safe);
      if (cut >= safe * 0.5) break;
    }
    if (cut < safe * 0.5) cut = o.lastResort === "last-boundary" && cut > 0 ? cut : safe;
    if (o.surrogateGuard && cut < rem.length) {
      const c = rem.charCodeAt(cut);
      if (c >= 0xdc00 && c <= 0xdfff) cut -= 1;
    }
    if (cut <= 0) cut = safe;
    out.push(rem.slice(0, cut));
    rem = rem.slice(cut).replace(strip, "");
  }
  if (rem.length > 0) out.push(rem);
  return out;
}

describe("chunkByGrapheme closes and reopens a fence at every cut inside one", () => {
  const cases: Array<[string, { limit: number; partLimit?: number }]> = [
    ["limit only (buzz, clickclack, twitch, zalo)", { limit: 500 }],
    ["partLimit below limit (sms)", { limit: 600, partLimit: 560 }],
    ["line", { limit: 450 }],
  ];
  for (const [name, options] of cases) {
    it(name, () => {
      const parts = chunkByGrapheme(BLOCK, options);
      expectBalanced(parts, options.partLimit ?? options.limit);
    });
  }

  it("splits text with no fence into the same parts as a plain walk", () => {
    const text = "héllo 👍🏽 wörld ".repeat(80);
    const parts = chunkByGrapheme(text, { limit: 100 });
    expect(parts.join("")).toBe(text);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    let buf = "";
    const old: string[] = [];
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      text,
    )) {
      if (buf.length + segment.length > 100) {
        old.push(buf);
        buf = "";
      }
      buf += segment;
    }
    old.push(buf);
    expect(parts).toEqual(old);
  });
});
