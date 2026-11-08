import { describe, expect, it } from "vitest";

import { dmPoke, readChatFact, rsvpPoke } from "../src/wire.js";
import { essayFact } from "./fake-ship.js";

describe("readChatFact", () => {
  it("reads a /v3 DM essay into its partner, id, author and text", () => {
    expect(readChatFact(essayFact({ from: "~zod", id: "~zod/170.141", text: "hello" }))).toEqual({
      kind: "essay",
      whom: "~zod",
      id: "~zod/170.141",
      author: "~zod",
      text: "hello",
      sent: 1_700_000_000_000,
    });
  });

  it("joins the string inlines of every verse and skips the rest", () => {
    const fact = {
      whom: "~zod",
      id: "~zod/1",
      response: {
        add: {
          essay: {
            author: "~zod",
            sent: 1,
            content: [{ inline: ["a ", { bold: ["b"] }, "c"] }, { inline: ["d"] }, { block: {} }],
          },
        },
      },
    };

    expect(readChatFact(fact)).toMatchObject({ kind: "essay", text: "a c\nd" });
  });

  it("reads the /v3 invite list as the ships that invited the bot", () => {
    expect(readChatFact([{ ship: "~nec" }, { ship: "bud" }])).toEqual({
      kind: "invites",
      ships: ["~nec", "~bud"],
    });
  });

  it("reads anything else as other", () => {
    expect(readChatFact({ whom: "~zod", id: "x", response: { del: null } })).toEqual({
      kind: "other",
    });
  });
});

describe("dmPoke", () => {
  it("builds the chat-dm-action json OpenClaw sends (send.ts lines 41 to 80)", () => {
    const poke = dmPoke("~bot", "~zod", "hi", 1_700_000_000_000, undefined);

    expect(poke.json).toEqual({
      ship: "~zod",
      diff: {
        id: poke.messageId,
        delta: {
          add: {
            memo: { content: [{ inline: ["hi"] }], author: "~bot", sent: 1_700_000_000_000 },
            kind: null,
            time: null,
          },
        },
      },
    });
    expect(poke.messageId).toMatch(/^~bot\/\d{1,3}(\.\d{3})*$/);
  });

  it("gives two sends in the same millisecond different ids (EC-15)", () => {
    const first = dmPoke("~bot", "~zod", "a", 1_700_000_000_000, undefined);
    const second = dmPoke("~bot", "~zod", "b", 1_700_000_000_000, first.sentAt);

    expect(second.messageId).not.toBe(first.messageId);
    expect(second.sentAt).toBeGreaterThan(first.sentAt);
  });
});

describe("rsvpPoke", () => {
  it("accepts an invite from a ship", () => {
    expect(rsvpPoke("~nec")).toEqual({ ship: "~nec", ok: true });
  });
});
