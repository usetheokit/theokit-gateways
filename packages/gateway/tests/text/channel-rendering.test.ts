import { describe, expect, it } from "vitest";

import { channelRendering } from "../../src/index.js";
import { toDialect } from "../../src/text/dialect.js";
import type { PlatformName } from "../../src/types/message-event.js";

/**
 * B-019 FR-001, FR-002, NFR-001: one `{ translate, format }` pair per platform, the two things
 * `ChatPresenter` needs so that no inline markdown marker reaches a platform that would show it as
 * literal characters.
 *
 * The table is the alignment brief's FR-002. Composed with their defaults, `ChatPresenter` declares
 * `markdown` and `toDialect` passes unknown platforms through, so matrix and email received
 * `**bold**` as characters and telegram and slack were handed a bold spelled for another dialect.
 */

const ALL_PLATFORMS = [
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
  "signal",
  "imessage",
] as const satisfies readonly PlatformName[];

// `PlatformName` is a derived type with no runtime list, so the list above is checked against it
// at compile time: a platform added to the union and missing here fails `tsc`, which the package's
// `test` script runs over `tests/`.
type MissingFromList = Exclude<PlatformName, (typeof ALL_PLATFORMS)[number]>;
const listIsComplete: [MissingFromList] extends [never] ? true : false = true;

const SINGLE_CHARACTER: readonly PlatformName[] = ["whatsapp", "slack"];
const MARKDOWN_AS_IS: readonly PlatformName[] = ["discord", "mattermost", "teams", "signal"];
const PLAIN: readonly PlatformName[] = ["telegram", "matrix", "email", "line", "sms", "imessage"];

describe("channelRendering", () => {
  it("covers every platform", () => {
    expect(listIsComplete).toBe(true);
    for (const platform of ALL_PLATFORMS) {
      const rendering = channelRendering(platform);
      expect(typeof rendering.translate, platform).toBe("function");
      expect(["plain", "markdown"], platform).toContain(rendering.format);
    }
  });

  it("gives whatsapp and slack single-character emphasis", () => {
    for (const platform of SINGLE_CHARACTER) {
      expect(channelRendering(platform).translate("**b** _e_ ~~s~~"), platform).toBe("*b* _e_ ~s~");
    }
    expect(channelRendering("whatsapp").format).toBe("plain");
    expect(channelRendering("slack").format).toBe("markdown");
  });

  it("leaves discord, mattermost and teams markdown untouched", () => {
    const text = "**b** _e_ ~~s~~ `c`";
    for (const platform of MARKDOWN_AS_IS) {
      const rendering = channelRendering(platform);
      expect(rendering.translate(text), platform).toBe(text);
      expect(rendering.format, platform).toBe("markdown");
    }
  });

  it("removes the markers for every plain platform", () => {
    for (const platform of PLAIN) {
      const rendering = channelRendering(platform);
      expect(rendering.translate("**b** _e_ ~~s~~ `c`"), platform).toBe("b e s c");
      expect(rendering.format, platform).toBe("plain");
    }
  });

  it.each(ALL_PLATFORMS)("returns the same output on every call for %s", (platform) => {
    const text = "**Oi!** _a_ ~~b~~ `c` 👋";
    const { translate } = channelRendering(platform);
    expect(translate(text)).toBe(translate(text));
  });

  it("refuses a platform it does not know", () => {
    // A JavaScript caller, or one holding a name from a newer adapter, can reach this. Returning
    // undefined would let ChatPresenter fall back to identity and markdown: the asterisk defect,
    // silently.
    const call = (): unknown => channelRendering("irc" as PlatformName);
    expect(call).toThrow(RangeError);
    expect(call).toThrow(/"irc"/);
    for (const platform of ALL_PLATFORMS) {
      expect(call).toThrow(new RegExp(`\\b${platform}\\b`));
    }
  });

  it("refuses a name inherited from Object.prototype", () => {
    // A plain index into the table would return Object.prototype.constructor here, a function, and
    // the caller would get something that is not a rendering instead of an error.
    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(() => channelRendering(name as PlatformName), name).toThrow(RangeError);
    }
  });

  it("matches toDialect for whatsapp, line and sms", () => {
    const samples = ["**a** *b* _c_ ~~d~~ `e`", "snake_case_name", "2*3*4", "**unpaired"];
    for (const platform of ["whatsapp", "line", "sms"] as const) {
      const { translate } = channelRendering(platform);
      for (const sample of samples) {
        expect(translate(sample), `${platform}: ${sample}`).toBe(toDialect(sample, platform));
      }
    }
  });

  it("returns an empty string and marker-free text unchanged", () => {
    for (const platform of ALL_PLATFORMS) {
      const { translate } = channelRendering(platform);
      expect(translate(""), platform).toBe("");
      expect(translate("Oi! 👋 snake_case_name"), platform).toBe("Oi! 👋 snake_case_name");
    }
  });

  it("leaves no double asterisk on a platform that translates", () => {
    const text = "**bold** and _em_";
    for (const platform of [...SINGLE_CHARACTER, ...PLAIN]) {
      expect(channelRendering(platform).translate(text), platform).not.toContain("**");
    }
    for (const platform of PLAIN) {
      expect(channelRendering(platform).translate(text), platform).toBe("bold and em");
    }
  });

  it("leaves an unpaired marker in place", () => {
    for (const platform of ALL_PLATFORMS) {
      expect(channelRendering(platform).translate("**unpaired"), platform).toBe("**unpaired");
    }
  });

  it("keeps markers inside inline code", () => {
    const text = "a **b** `c*d*` e";
    for (const platform of PLAIN) {
      expect(channelRendering(platform).translate(text), platform).toBe("a b c*d* e");
    }
    expect(channelRendering("slack").translate(text)).toBe("a *b* `c*d*` e");
  });
});
