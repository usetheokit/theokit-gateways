import { channelRendering, type PlatformName } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { splitForDiscord } from "../../../packages/gateway-discord/src/split.js";
import { splitForIrc } from "../../../packages/gateway-irc/src/split.js";
import { splitForLine } from "../../../packages/gateway-line/src/split.js";
import { splitForMattermost } from "../../../packages/gateway-mattermost/src/split.js";
import { splitForTalk } from "../../../packages/gateway-nextcloud-talk/src/split.js";
import { splitForSlack } from "../../../packages/gateway-slack/src/split.js";
import { splitForSMS } from "../../../packages/gateway-sms/src/split.js";
import { splitForTeams } from "../../../packages/gateway-teams/src/split.js";
import { splitForTelegram } from "../../../packages/gateway-telegram/src/split.js";
import { splitForWhatsApp } from "../../../packages/gateway-whatsapp/src/split.js";

/**
 * B-556: the measurement over the ten platforms that have a splitter, kept as a test. For a
 * Markdown table and for a table longer than the platform's limit, `channelRendering(p).translate`
 * may rewrite emphasis inside a cell but leaves every row's cells and pipes; the platform's
 * splitter then delivers every translated row whole in one part. The recorded results are in
 * docs/table-measurement.md.
 */

interface Platform {
  readonly name: PlatformName;
  readonly split: (text: string) => string[];
  /** The part size the splitter works within, in characters (IRC: bytes of one PRIVMSG body). */
  readonly limit: number;
  /** Strips what the splitter adds around a part (SMS prefixes `(i/N) `). */
  readonly unwrap?: (part: string) => string;
}

const PLATFORMS: readonly Platform[] = [
  { name: "discord", split: splitForDiscord, limit: 1900 },
  { name: "slack", split: splitForSlack, limit: 4000 },
  { name: "telegram", split: splitForTelegram, limit: 4000 },
  { name: "whatsapp", split: splitForWhatsApp, limit: 4096 },
  { name: "teams", split: splitForTeams, limit: 8000 },
  { name: "mattermost", split: splitForMattermost, limit: 16_000 },
  { name: "irc", split: (t) => splitForIrc(t, "#c"), limit: 390 },
  { name: "line", split: splitForLine, limit: 5000 },
  { name: "sms", split: splitForSMS, limit: 1590, unwrap: (p) => p.replace(/^\(\d+\/\d+\) /, "") },
  { name: "nextcloud_talk", split: splitForTalk, limit: 32_000 },
];

const cell = (n: number): string => "x".repeat(Math.max(1, n));
const richRow = (i: number): string => `| ${i} | **b${i}** | \`c${i}\` | note ${i} |`;

/** A table whose rows alternate between a fifth of `limit` and `fraction` of it, so a long row straddles a cut. */
function straddlingTable(limit: number, fraction: number): string {
  const rows = ["| id | note |", "|---|---|"];
  for (let i = 0; i < 8; i += 1) {
    rows.push(`| ${i} | ${cell(Math.floor(limit * (i % 2 === 0 ? 0.2 : fraction)))} |`);
  }
  return rows.join("\n");
}

/** A rich table at least `minLength` characters long. */
function longRichTable(minLength: number): string {
  const rows = ["| id | bold | code | note |", "|---|---|---|---|"];
  let length = rows.join("\n").length;
  for (let i = 0; length < minLength; i += 1) {
    rows.push(richRow(i));
    length += rows[rows.length - 1].length + 1;
  }
  return rows.join("\n");
}

const rowsOf = (text: string): string[] => text.split("\n").filter((l) => l.startsWith("|"));

function partsOf(p: Platform, text: string): string[] {
  const parts = p.split(text);
  return p.unwrap === undefined ? parts : parts.map(p.unwrap);
}

describe.each(PLATFORMS)("table rows on $name", (p) => {
  const translate = channelRendering(p.name).translate;

  it("keeps the cells and pipes of a short table through translate", () => {
    const table = longRichTable(150);
    const out = translate(table);
    const pipes = (t: string): number[] => rowsOf(t).map((r) => r.split("|").length);
    expect(pipes(out)).toEqual(pipes(table));
    expect(p.split(out).join("\n")).toContain(rowsOf(out)[2] as string);
  });

  it("delivers every row of a table longer than the limit whole in one part", () => {
    const table = longRichTable(p.limit * 2.3);
    const out = translate(table);
    const parts = partsOf(p, out);
    expect(parts.length).toBeGreaterThan(1);
    const delivered = new Set(parts.flatMap((part) => part.split("\n")));
    expect(rowsOf(out).filter((row) => !delivered.has(row))).toEqual([]);
  });

  it.each([0.3, 0.55, 0.7, 0.9])(
    "delivers a row of %s of the limit whole when it straddles a cut",
    (fraction) => {
      const out = translate(straddlingTable(p.limit, fraction));
      const delivered = new Set(partsOf(p, out).flatMap((part) => part.split("\n")));
      expect(rowsOf(out).filter((row) => !delivered.has(row))).toEqual([]);
    },
  );
});
