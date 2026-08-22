/**
 * Sender allowlist tests.
 *
 * The package had no sender filter at all: `shouldDropGroupMessage` fires only for
 * groups with `requireMention`, so a stranger's DM reached the handler untouched.
 * Two things make that worse than untidy. A number that auto-answers strangers
 * collects blocks and reports, which is what WhatsApp bans run on; and an agent
 * driven by tools will act on whatever arrives.
 */

import { describe, expect, it } from "vitest";

import { isSenderAllowed, normalizeWhatsAppId, parseAllowedSenders } from "../src/allowlist.js";

describe("normalizeWhatsAppId", () => {
  it("reduces a plain JID to its digits", () => {
    expect(normalizeWhatsAppId("5511999999999@s.whatsapp.net")).toBe("5511999999999");
  });

  it("drops the device suffix instead of folding it into the number", () => {
    // `:12` is a device id, not part of the phone number. Stripping non-digits
    // without removing it first yields 551199999999912 — a number that matches
    // nothing, so every allowlist entry silently stops working for that sender.
    expect(normalizeWhatsAppId("5511999999999:12@s.whatsapp.net")).toBe("5511999999999");
  });

  it("accepts the shapes a human actually types", () => {
    expect(normalizeWhatsAppId("+55 (11) 99999-9999")).toBe("5511999999999");
    expect(normalizeWhatsAppId("  +5511999999999  ")).toBe("5511999999999");
  });

  it("reduces a group JID to its digits so a group can be allowlisted too", () => {
    expect(normalizeWhatsAppId("120363012345678901@g.us")).toBe("120363012345678901");
  });

  it("returns empty for input that carries no identifier", () => {
    expect(normalizeWhatsAppId("")).toBe("");
    expect(normalizeWhatsAppId("   ")).toBe("");
    expect(normalizeWhatsAppId("@s.whatsapp.net")).toBe("");
  });
});

describe("parseAllowedSenders", () => {
  it("parses a comma-separated list, normalising each entry", () => {
    const set = parseAllowedSenders("+55 11 99999-9999, 5511888888888@s.whatsapp.net");
    expect([...set].sort()).toEqual(["5511888888888", "5511999999999"]);
  });

  it("ignores blank entries rather than admitting an empty identifier", () => {
    // ",," would otherwise put "" in the set, and "" normalises from any input
    // that carries no identifier — which would admit exactly the senders whose
    // id we failed to read.
    expect(parseAllowedSenders("5511999999999,,  ,").size).toBe(1);
  });

  it("keeps the wildcard as a wildcard instead of stripping it to nothing", () => {
    expect(parseAllowedSenders("*").has("*")).toBe(true);
  });

  it("returns an empty set for undefined or blank input", () => {
    expect(parseAllowedSenders(undefined).size).toBe(0);
    expect(parseAllowedSenders("").size).toBe(0);
    expect(parseAllowedSenders("   ").size).toBe(0);
  });
});

describe("isSenderAllowed", () => {
  it("admits nobody when the allowlist is empty — fail closed", () => {
    // The whole point. An unset allowlist is an operator who has not decided,
    // and the safe reading of "has not decided" is "not yet".
    expect(isSenderAllowed("5511999999999@s.whatsapp.net", parseAllowedSenders(undefined))).toBe(
      false,
    );
    expect(isSenderAllowed("5511999999999@s.whatsapp.net", parseAllowedSenders(""))).toBe(false);
  });

  it("admits everyone only when the wildcard is set explicitly", () => {
    expect(isSenderAllowed("5511999999999@s.whatsapp.net", parseAllowedSenders("*"))).toBe(true);
  });

  it("admits a listed sender whatever shape the id arrives in", () => {
    const allowed = parseAllowedSenders("+55 11 99999-9999");
    expect(isSenderAllowed("5511999999999@s.whatsapp.net", allowed)).toBe(true);
    expect(isSenderAllowed("5511999999999:3@s.whatsapp.net", allowed)).toBe(true);
    expect(isSenderAllowed("5511999999999", allowed)).toBe(true);
  });

  it("refuses a sender who is not listed", () => {
    expect(
      isSenderAllowed("5511000000000@s.whatsapp.net", parseAllowedSenders("5511999999999")),
    ).toBe(false);
  });

  it("refuses an unreadable sender id even when the list is non-empty", () => {
    // An id we could not parse must not fall through to "allowed". It normalises
    // to "", and "" is never a member of a list built by parseAllowedSenders.
    expect(isSenderAllowed("", parseAllowedSenders("5511999999999"))).toBe(false);
    expect(isSenderAllowed("@s.whatsapp.net", parseAllowedSenders("5511999999999"))).toBe(false);
  });

  it("still refuses an unreadable sender id under the wildcard", () => {
    // Debatable, and decided deliberately: `*` means "any sender", and something
    // whose sender we cannot identify is not a sender we can name. Letting it
    // through would make the wildcard the one path that skips identification.
    expect(isSenderAllowed("", parseAllowedSenders("*"))).toBe(false);
  });
});
