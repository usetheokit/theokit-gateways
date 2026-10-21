/**
 * `irc` is a first-party platform (B-357, plan ADR D1).
 *
 * These assertions run under `tsc`, which the package's `test` script runs before vitest: an
 * assignment that does not type-check fails the suite even though vitest itself strips types.
 */

import { describe, expect, it } from "vitest";

import type { IrcMessageEvent, MessageEvent, PlatformName } from "../../src/index.js";

function makeIrcEvent(): MessageEvent {
  return {
    id: "irc-1",
    platform: "irc",
    sender: { id: "ana", displayName: "ana" },
    channel: { id: "#theokit", type: "group" },
    text: "waves",
    receivedAt: 0,
    irc: {
      target: "#theokit",
      nick: "ana",
      action: true,
      tags: { time: "2026-10-21T05:30:00.000Z" },
      raw: "@time=2026-10-21T05:30:00.000Z :ana!a@host PRIVMSG #theokit :\u0001ACTION waves\u0001",
    },
  };
}

describe("IrcMessageEvent", () => {
  it("names irc as a platform", () => {
    const name: PlatformName = "irc";

    expect(name).toBe("irc");
  });

  it("narrows to the irc variant on its discriminator", () => {
    const event = makeIrcEvent();
    if (event.platform !== "irc") throw new Error("unreachable");
    const narrowed: IrcMessageEvent = event;

    expect(narrowed.irc.action).toBe(true);
    expect(narrowed.irc.tags.time).toBe("2026-10-21T05:30:00.000Z");
  });
});
