import { describe, expect, it } from "vitest";

import { CLICKCLACK_MESSAGE_LIMIT, ClickClackAdapter } from "../src/index.js";

describe("ClickClackAdapter.capabilities", () => {
  it("reports the splitter's limit and no threads", () => {
    const c = new ClickClackAdapter({
      baseUrl: "https://chat.test/",
      token: "t",
      workspaceId: "w",
      botUserId: "b",
    }).capabilities;
    expect(c.maxMessageChars).toBe(CLICKCLACK_MESSAGE_LIMIT);
    expect(c.threads).toBe(false);
  });
});
