/**
 * `decideInbound` — the inbound rules both adapter paths decide through (B-421, ADR D2).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseAllowedSenders } from "../src/allowlist.js";
import type { WhatsAppInboundEvent } from "../src/backend-types.js";
import { decideInbound, type InboundRules } from "../src/inbound-rules.js";

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
      '[whatsapp] dropped inbound from "5511888888888" — not in the configured allowlist\n',
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
