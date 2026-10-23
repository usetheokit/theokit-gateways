/**
 * The core never branches on a platform name (NFR-004; alignment AC-010).
 *
 * `createChannels` and the descriptor type live under `src/channel/`, and neither those files nor
 * the runner may hold a string or template literal equal to one of the platform names. A
 * literal check is enough in the core: it never imports a descriptor, so every comparison against
 * a platform would need the name written as a literal.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PLATFORM_NAMES = [
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "matrix",
  "mattermost",
  "email",
  "sms",
  "line",
  "teams",
  "signal",
  "imessage",
  "google_chat",
  "google-chat",
  "irc",
  "nextcloud_talk",
  "nextcloud-talk",
] as const;

const SRC = new URL("../../src/", import.meta.url).pathname;
const CHANNEL_DIR = join(SRC, "channel");
const RUNNER = join(SRC, "runner", "gateway-runner.ts");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every string or template literal in `source` whose whole value is a platform name. */
function platformLiterals(source: string): string[] {
  const found: string[] = [];
  const literal = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  for (const match of stripComments(source).matchAll(literal)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if ((PLATFORM_NAMES as readonly string[]).includes(value)) found.push(match[0]);
  }
  return found;
}

async function channelFiles(): Promise<string[]> {
  const entries = await readdir(CHANNEL_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(CHANNEL_DIR, e.name));
}

describe("channel module names no platform", () => {
  it("the descriptor type and createChannels live under src/channel", async () => {
    const descriptor = await readFile(join(CHANNEL_DIR, "channel-descriptor.ts"), "utf8");
    const create = await readFile(join(CHANNEL_DIR, "create-channels.ts"), "utf8");
    const index = await readFile(join(SRC, "index.ts"), "utf8");

    expect(descriptor).toMatch(/export type ChannelDescriptor\b/);
    expect(create).toMatch(/export function createChannels\b/);
    expect(index).toMatch(
      /\bChannelDescriptor\b[\s\S]*?from "\.\/channel\/channel-descriptor\.js"/,
    );
    expect(index).toMatch(/\bcreateChannels\b[\s\S]*?from "\.\/channel\/create-channels\.js"/);
  });

  it("no file under src/channel or the runner names a platform", async () => {
    const files = [...(await channelFiles()), RUNNER];
    expect(files.length).toBeGreaterThan(1);
    const offenders: string[] = [];
    for (const file of files) {
      for (const literal of platformLiterals(await readFile(file, "utf8"))) {
        offenders.push(`${file}: ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scan flags a platform name in each quote style", () => {
    const sample = [
      'if (p === "line") a();',
      "if (p === 'telegram') b();",
      "if (p === `line`) c();",
      "// a comment naming 'slack' is not code",
      'const label = "lines";',
    ].join("\n");

    expect(platformLiterals(sample)).toEqual(['"line"', "'telegram'", "`line`"]);
  });
});
