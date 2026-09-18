import { describe, expect, it } from "vitest";

import { toDialect } from "../../src/text/dialect.js";

/**
 * B-019 FR-005 / AC-004 — the presenter translates markdown into the target channel's dialect.
 *
 * Measured 2026-09-17 across every `adapter.ts` and `split.ts` in the ten packages: no package
 * transforms a single character of text. What exists is markdown ESCAPE (discord, mattermost),
 * HTML escape (email), phone normalisation (whatsapp) and post-cut newline cleanup (telegram).
 * The adapters refuse translation deliberately — `gateway-whatsapp` reads `format` only to warn
 * once, because emphasis there is inline in the text.
 *
 * So the agent answered `**Bom Sucesso (MG)**` and both LINE and WhatsApp delivered the asterisks
 * to a real phone. This is the function that stops that, and it lives here rather than in an
 * adapter because it is presentation, not transport.
 */
describe("toDialect", () => {
  it("turns markdown bold into WhatsApp's inline emphasis", () => {
    expect(toDialect("**Bom Sucesso (MG)**", "whatsapp")).toBe("*Bom Sucesso (MG)*");
  });

  it("strips emphasis for LINE, which carries no rich text", () => {
    expect(toDialect("**Bom Sucesso (MG)**", "line")).toBe("Bom Sucesso (MG)");
  });

  it("leaves telegram untouched — it parses markdown natively", () => {
    expect(toDialect("**bold**", "telegram")).toBe("**bold**");
  });

  it("translates italic and strikethrough for WhatsApp too", () => {
    expect(toDialect("*em* and ~~gone~~", "whatsapp")).toBe("_em_ and ~gone~");
  });

  it("strips every marker for SMS, a medium with no markup at all", () => {
    expect(toDialect("**a** *b* ~~c~~ `d`", "sms")).toBe("a b c d");
  });

  it("is a no-op on text carrying no markers", () => {
    expect(toDialect("plain text", "whatsapp")).toBe("plain text");
  });

  it("leaves an unknown platform untouched rather than guessing its dialect", () => {
    // A platform this function has not been taught is a platform whose dialect nobody measured.
    // Passing the text through unchanged is wrong in a visible way; inventing a mapping is wrong
    // in an invisible one.
    expect(toDialect("**bold**", "matrix")).toBe("**bold**");
  });
});
