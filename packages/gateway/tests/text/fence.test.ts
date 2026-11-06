import { describe, expect, it } from "vitest";
import {
  channelRendering,
  chunkByGrapheme,
  chunkText,
  findFences,
  toDialect,
} from "../../src/index.js";
import { DIALECTS, rewriteMarkers } from "../../src/text/dialect.js";

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
  "nostr",
  "feishu_lark",
  "synology_chat",
  "tlon_urbit",
  "twitch",
] as const;

const FENCE = "```ts\nconst a = **b** * c;\n  _x_ ~~y~~ `z`\n\n\tindented\n```";
const TILDE = "~~~\n*raw* `code`\n~~~";
const DOC = `Use **bold** and \`inline\`.\n\n${FENCE}\n\nThen _italic_.\n\n${TILDE}\nafter *x*`;

describe("findFences", () => {
  it("finds backtick, tilde and unclosed fences", () => {
    const f = findFences(DOC);
    expect(f.map((r) => DOC.slice(r.start, r.end))).toEqual([FENCE, TILDE]);
    expect(findFences("a\n```\ncode")[0]?.end).toBe(10);
    expect(findFences("no fence `x` here")).toEqual([]);
    expect(findFences("```a`b\nx")).toEqual([]);
    expect(findFences("````\n```\n````")).toHaveLength(1);
  });
});

describe("fence-aware translation", () => {
  for (const platform of PLATFORMS) {
    it(`${platform}: the fenced block is byte-identical`, () => {
      for (const out of [channelRendering(platform).translate(DOC), toDialect(DOC, platform)]) {
        expect(out).toContain(FENCE);
        expect(out).toContain(TILDE);
      }
    });
  }
  it("still rewrites outside the fence", () => {
    expect(rewriteMarkers(DOC, {})).toContain("Use bold and inline.");
    expect(rewriteMarkers(DOC, DIALECTS.whatsapp)).toContain("*bold*");
  });
  it("text with no fence is rewritten as before", () => {
    expect(rewriteMarkers("**a** `b`", DIALECTS.whatsapp)).toBe("*a* ```b```");
  });
});

const CODE = Array.from({ length: 100 }, (_, i) => `  line_${i} = "*${i}*"`).join("\n");
const BIG = `intro text\n\n\`\`\`py\n${CODE}\n\`\`\`\n\noutro`;

const OPTIONS: Record<string, Parameters<typeof chunkText>[1]> = {
  discord: { limit: 400, safeLimit: 380, boundaries: ["\n\n", "\n"] },
  mattermost: { limit: 400, safeLimit: 380, boundaries: ["\n\n", "\n"] },
  slack: {
    limit: 400,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
  },
  whatsapp: {
    limit: 400,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
    trimParts: true,
  },
  teams: {
    limit: 400,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
    trimParts: true,
  },
};

function balanced(part: string): boolean {
  return (
    findFences(part).every(
      (f) => f.closeStart < f.end || (f.end === part.length && part.endsWith("```")),
    ) && (part.match(/^```/gm)?.length ?? 0) % 2 === 0
  );
}

function codeLines(parts: string[]): string[] {
  return parts.flatMap((p) => p.split("\n")).filter((l) => l.startsWith("  line_"));
}

describe("fence-aware chunking", () => {
  for (const [name, options] of Object.entries(OPTIONS)) {
    it(`chunkText as ${name} closes and reopens, keeping every code line`, () => {
      const parts = chunkText(BIG, options);
      expect(parts.length).toBeGreaterThan(3);
      for (const p of parts) {
        expect(p.length).toBeLessThanOrEqual(options.limit);
        expect(balanced(p)).toBe(true);
      }
      expect(codeLines(parts)).toEqual(CODE.split("\n"));
      expect(parts.filter((p) => p.includes("```py")).length).toBeGreaterThan(2);
    });
  }
  for (const [name, options] of Object.entries({
    line: { limit: 400 },
    sms: { limit: 400, partLimit: 380 },
    twitch: { limit: 400 },
  })) {
    it(`chunkByGrapheme as ${name} closes and reopens, keeping every code line`, () => {
      const parts = chunkByGrapheme(BIG, options);
      expect(parts.length).toBeGreaterThan(3);
      for (const p of parts) {
        expect(p.length).toBeLessThanOrEqual(options.partLimit ?? options.limit);
        expect(balanced(p)).toBe(true);
      }
      expect(codeLines(parts)).toEqual(CODE.split("\n"));
    });
  }
  it("terminates when the opening line leaves no room", () => {
    const parts = chunkText("```aaaaaaaaaaaaaaaaaaaaaaaa\nx\ny\nz\n```", { limit: 12 });
    expect(parts.join("")).toContain("z");
  });
  it("splits text with no fence exactly as before", () => {
    const text = Array.from({ length: 80 }, (_, i) => `para ${i} *x*\n\nmore words here`).join(
      "\n\n",
    );
    const opts = {
      limit: 300,
      boundaries: ["\n\n", "\n", " "],
      lastResort: "last-boundary",
      surrogateGuard: true,
      stripLeading: /^\s+/,
    } as const;
    expect(chunkText(text, opts)).toMatchSnapshot();
    expect(chunkByGrapheme(text, { limit: 300 })).toMatchSnapshot();
  });
});
