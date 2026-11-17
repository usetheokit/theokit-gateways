import { describe, expect, it } from "vitest";

import { ZALO_MESSAGE_LIMIT, ZaloAdapter } from "../src/index.js";

describe("ZaloAdapter.capabilities", () => {
  it("reports the splitter's limit and no threads", () => {
    const c = new ZaloAdapter({ appId: "a", oaSecretKey: "s", accessToken: "t" }).capabilities;
    expect(c.maxMessageChars).toBe(ZALO_MESSAGE_LIMIT);
    expect(c.threads).toBe(false);
  });
});
