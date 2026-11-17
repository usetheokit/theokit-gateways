/** WhatsAppAdapter.capabilities — the splitter's limit is what the adapter reports. */

import { describe, expect, it } from "vitest";

import { WhatsAppAdapter } from "../src/adapter.js";
import { WHATSAPP_MAX_TEXT } from "../src/split.js";

describe("WhatsAppAdapter.capabilities", () => {
  it("reports the splitter limit and threads", () => {
    const c = new WhatsAppAdapter({ start: async () => undefined } as never).capabilities;
    expect(c.maxMessageChars).toBe(WHATSAPP_MAX_TEXT);
    expect(c.threads).toBe(false);
  });
});
