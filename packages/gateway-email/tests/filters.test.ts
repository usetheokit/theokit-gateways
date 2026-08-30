/**
 * Filter tests (T4.1 + T4.2 + EC-3).
 */

import { describe, expect, it } from "vitest";

import { extractAddr, isAllowedSender, isAutomatedSender } from "../src/filters.js";

describe("extractAddr (EC-3)", () => {
  it("extracts bracketed address", () => {
    expect(extractAddr('"Alice" <alice@example.com>')).toBe("alice@example.com");
  });

  it("returns pure address unchanged", () => {
    expect(extractAddr("alice@example.com")).toBe("alice@example.com");
  });

  it("lowercases + trims", () => {
    expect(extractAddr("  Alice@Example.COM  ")).toBe("alice@example.com");
  });
});

describe("isAutomatedSender (D332)", () => {
  const noHeaders = new Map<string, string>();

  it("test_filter_blocks_noreply_addresses", () => {
    expect(isAutomatedSender("noreply@example.com", noHeaders)).toBe(true);
    expect(isAutomatedSender("no-reply@example.com", noHeaders)).toBe(true);
    expect(isAutomatedSender("donotreply@example.com", noHeaders)).toBe(true);
  });

  it("test_filter_blocks_postmaster", () => {
    expect(isAutomatedSender("postmaster@example.com", noHeaders)).toBe(true);
  });

  it("test_filter_blocks_mailer_daemon", () => {
    expect(isAutomatedSender("mailer-daemon@example.com", noHeaders)).toBe(true);
  });

  it("test_filter_blocks_auto_submitted_header", () => {
    const h = new Map([["Auto-Submitted", "auto-generated"]]);
    expect(isAutomatedSender("alice@example.com", h)).toBe(true);
  });

  it("test_filter_blocks_precedence_bulk_header", () => {
    const h = new Map([["Precedence", "bulk"]]);
    expect(isAutomatedSender("alice@example.com", h)).toBe(true);
  });

  it("test_filter_blocks_precedence_list_header", () => {
    const h = new Map([["Precedence", "list"]]);
    expect(isAutomatedSender("alice@example.com", h)).toBe(true);
  });

  it("blocks Microsoft X-Auto-Response-Suppress", () => {
    const h = new Map([["X-Auto-Response-Suppress", "All"]]);
    expect(isAutomatedSender("alice@example.com", h)).toBe(true);
  });

  it("test_filter_allows_normal_user_address", () => {
    expect(isAutomatedSender("alice@example.com", noHeaders)).toBe(false);
  });

  it("test_filter_case_insensitive", () => {
    expect(isAutomatedSender("NOREPLY@example.com", noHeaders)).toBe(true);
  });

  it.each([
    // RFC 3834 defines `no` as the value that says a message is NOT auto-submitted. A client that
    // sets it honestly must not be silenced BECAUSE it was honest.
    ["Auto-Submitted", "no"],
    ["Precedence", "normal"],
    ["X-Auto-Response-Suppress", "None"],
  ])("lets a human through when %s is present but says otherwise", (header, value) => {
    // Every existing case supplies a header whose value MATCHES, so `typeof x === "string" && …`
    // was indistinguishable from `typeof x === "string" || …`: with no header both are false, and
    // with a matching header both are true. Only a header that is present and does not match
    // separates them — and under `||` that sender is blocked, which is a human going unanswered.
    expect(isAutomatedSender("alice@example.com", new Map([[header, value]]))).toBe(false);
  });

  it("blocks a noreply address only at the START of the local part", () => {
    // `/^(noreply|…)@/`. Without the anchor, any address CONTAINING one of those words matches —
    // `not-noreply@example.com` and `team-notifications@example.com` are real addresses belonging
    // to real people, and blocking them is silent: the bot simply never answers.
    expect(isAutomatedSender("noreply@example.com", noHeaders)).toBe(true);
    expect(isAutomatedSender("not-noreply@example.com", noHeaders)).toBe(false);
    expect(isAutomatedSender("team-notifications@example.com", noHeaders)).toBe(false);
  });
});

describe("isAllowedSender (D333 + EC-3)", () => {
  it("test_allowed_sender_undefined_allowlist_allows_all", () => {
    expect(isAllowedSender("alice@example.com", undefined)).toBe(true);
  });

  it("test_allowed_sender_empty_allowlist_denies_all", () => {
    expect(isAllowedSender("alice@example.com", [])).toBe(false);
  });

  it("test_allowed_sender_exact_match", () => {
    expect(isAllowedSender("alice@example.com", ["alice@example.com"])).toBe(true);
  });

  it("test_allowed_sender_case_insensitive", () => {
    expect(isAllowedSender("Alice@Example.COM", ["alice@example.com"])).toBe(true);
  });

  it("test_allowed_sender_not_in_list_denied", () => {
    expect(isAllowedSender("eve@example.com", ["alice@example.com"])).toBe(false);
  });

  it("test_allowed_sender_bracketed_allowlist_entry (EC-3)", () => {
    expect(isAllowedSender("alice@example.com", ['"Alice" <alice@example.com>'])).toBe(true);
  });

  it("test_allowed_sender_pure_email_in_allowlist (EC-3) — no regression", () => {
    expect(isAllowedSender("alice@example.com", ["alice@example.com"])).toBe(true);
  });
});
