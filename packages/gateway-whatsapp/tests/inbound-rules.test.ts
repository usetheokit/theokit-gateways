/**
 * `decideInbound` — the inbound rules both adapter paths decide through (B-421, ADR D2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseAllowedSenders } from "../src/allowlist.js";
import type { WhatsAppInboundEvent } from "../src/backend-types.js";
import { decideInbound, type InboundRules, isForAnotherNumber } from "../src/inbound-rules.js";

function inboundFrom(
  fromPhone: string,
  overrides: Partial<WhatsAppInboundEvent> = {},
): WhatsAppInboundEvent {
  return {
    wamid: "wamid.1",
    fromPhone,
    phoneNumberId: "PNID",
    contactName: "Test User",
    conversationType: "dm",
    channelId: fromPhone,
    text: "note to self",
    receivedAt: 1_700_000_000_000,
    backend: "cloud",
    raw: { id: "wamid.1" },
    ...overrides,
  };
}

function rules(opts: { allowedSenders?: string }): InboundRules {
  return {
    allowedSenders:
      opts.allowedSenders === undefined ? undefined : parseAllowedSenders(opts.allowedSenders),
    requireMention: true,
    botPhoneId: "",
  };
}

let stderrLines: string[] = [];

beforeEach(() => {
  stderrLines = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderrLines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("decideInbound", () => {
  it("decideInbound refuses a sender the allowlist does not name", () => {
    const refused = decideInbound(
      inboundFrom("5511888888888"),
      rules({ allowedSenders: "5511999999999" }),
    );
    expect(refused).toBeUndefined();
    expect(stderrLines).toEqual([
      "[whatsapp] dropped inbound from a sender ending in 8888: not in the configured allowlist\n",
    ]);
  });

  it("decideInbound never writes a refused sender's full number to stderr", () => {
    decideInbound(inboundFrom("5511888888888"), rules({ allowedSenders: "5511999999999" }));
    decideInbound(inboundFrom("231116569108705@lid"), rules({ allowedSenders: "5511999999999" }));

    expect(stderrLines.join("")).not.toMatch(/5511888888888|231116569108705/);
  });

  it("decideInbound names a refused sender with no digit as a sender with no number", () => {
    decideInbound(inboundFrom("stranger@lid"), rules({ allowedSenders: "5511999999999" }));

    expect(stderrLines).toEqual([
      "[whatsapp] dropped inbound from a sender with no number: not in the configured allowlist\n",
    ]);
  });

  it("decideInbound names a refused group sender once and writes no group line", () => {
    // The allowlist runs before the group rule. With requireMention on and botPhoneId unset the
    // group rule would drop this message too, with its own line; the refusal must come first, so
    // the sender is named and the group line is never written.
    const refused = decideInbound(
      inboundFrom("5511888888888", {
        conversationType: "group",
        channelId: "g@g.us",
        text: "hello all",
      }),
      rules({ allowedSenders: "5511999999999" }),
    );

    expect(refused).toBeUndefined();
    expect(stderrLines).toEqual([
      "[whatsapp] dropped inbound from a sender ending in 8888: not in the configured allowlist\n",
    ]);
  });

  it("decideInbound keeps the owner's own note under an allowlist", () => {
    const note = decideInbound(
      { ...inboundFrom("231116569108705@lid"), fromSelf: true },
      rules({ allowedSenders: "553598838687" }),
    );
    expect(note).toBeDefined();
    expect(note?.text).toBe("note to self");
  });

  it("decideInbound converts an accepted message to the gateway shape", () => {
    const inbound = inboundFrom("5511999999999", { channelJid: "5511999999999@s.whatsapp.net" });
    const expectedEvent = {
      id: "wamid.1",
      platform: "whatsapp",
      sender: { id: "5511999999999", displayName: "Test User" },
      channel: { id: "5511999999999", type: "dm" },
      text: "note to self",
      receivedAt: 1_700_000_000_000,
      whatsapp: {
        wamid: "wamid.1",
        phoneNumberId: "PNID",
        contactName: "Test User",
        channelJid: "5511999999999@s.whatsapp.net",
        backend: "cloud",
        raw: { id: "wamid.1" },
      },
    };

    const converted = decideInbound(inbound, rules({}));

    expect(converted).toEqual(expectedEvent);
  });

  describe("the group rule", () => {
    const groupRules = (botPhoneId: string): InboundRules => ({
      allowedSenders: undefined,
      requireMention: true,
      botPhoneId,
    });
    const groupMessage = (text: string) =>
      inboundFrom("5511888888888", { conversationType: "group", channelId: "g@g.us", text });

    it("decideInbound keeps a group message that opens with the bot's number", () => {
      const kept = decideInbound(groupMessage("5511777777777 hi"), groupRules("5511777777777"));
      expect(kept?.text).toBe("5511777777777 hi");
    });

    it("decideInbound keeps a group message that ends with the bot's number", () => {
      const kept = decideInbound(groupMessage("hi 5511777777777"), groupRules("5511777777777"));
      expect(kept?.text).toBe("hi 5511777777777");
    });

    it("decideInbound reads a one-digit run as a number", () => {
      const kept = decideInbound(groupMessage("call 7 now"), groupRules("7"));
      expect(kept?.text).toBe("call 7 now");
    });

    it("decideInbound names the misconfiguration when botPhoneId is unset", () => {
      const dropped = decideInbound(groupMessage("hello all"), groupRules(""));
      expect(dropped).toBeUndefined();
      expect(stderrLines).toEqual([
        "[whatsapp] dropping every group message: requireMention is on and botPhoneId is unset\n",
      ]);
    });
  });
});

describe("isForAnotherNumber", () => {
  const OWN = "PNID";

  it("names a foreign phone number id by its last four digits only", () => {
    const dropped = isForAnotherNumber({ phoneNumberId: "109900001111" }, OWN, new Set());

    expect(dropped).toBe(true);
    expect(stderrLines).toEqual([
      '[whatsapp] dropped inbound addressed to a phone number id ending in 1111: this adapter answers for "PNID". Logged once per id ending.\n',
    ]);
  });

  it("cannot write a forged line through a foreign phone number id", () => {
    isForAnotherNumber({ phoneNumberId: "1\n[whatsapp] forged 2222" }, OWN, new Set());

    expect(stderrLines).toHaveLength(1);
    expect(stderrLines[0]).not.toContain("forged");
    expect(stderrLines[0]?.indexOf("\n")).toBe((stderrLines[0]?.length ?? 0) - 1);
  });

  it("keeps one report per four-digit ending however many foreign ids arrive", () => {
    const reported = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) {
      isForAnotherNumber({ phoneNumberId: String(109_900_000_000 + i) }, OWN, reported);
    }

    expect(reported.size).toBe(10_000);
    expect(stderrLines).toHaveLength(10_000);
  });

  it("names a foreign id with no digit and a message naming no id apart", () => {
    const reported = new Set<string>();
    isForAnotherNumber({ phoneNumberId: "OTHER" }, OWN, reported);
    isForAnotherNumber({ phoneNumberId: undefined }, OWN, reported);

    expect(stderrLines.map((line) => line.split(":")[0])).toEqual([
      "[whatsapp] dropped inbound addressed to a phone number id with no digits",
      "[whatsapp] dropped inbound addressed to no phone number id",
    ]);
  });

  it("drops nothing on the adapter's own number or when there is no own number", () => {
    const own = isForAnotherNumber({ phoneNumberId: OWN }, OWN, new Set());
    const noOwn = isForAnotherNumber({ phoneNumberId: "109900001111" }, undefined, new Set());

    expect([own, noOwn]).toEqual([false, false]);
    expect(stderrLines).toEqual([]);
  });
});
