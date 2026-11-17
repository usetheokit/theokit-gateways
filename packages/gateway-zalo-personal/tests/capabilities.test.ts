import { describe, expect, it } from "vitest";

import { ZALO_PERSONAL_MESSAGE_LIMIT, ZaloPersonalAdapter } from "../src/index.js";

describe("ZaloPersonalAdapter.capabilities", () => {
  it("reports the splitter's limit and no threads", () => {
    const c = new ZaloPersonalAdapter({ credentials: { cookie: [], imei: "i", userAgent: "u" } })
      .capabilities;
    expect(c.maxMessageChars).toBe(ZALO_PERSONAL_MESSAGE_LIMIT);
    expect(c.threads).toBe(false);
  });
});
