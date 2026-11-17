import { describe, expect, it } from "vitest";

import { BUZZ_MESSAGE_LIMIT, BuzzAdapter } from "../src/index.js";

describe("BuzzAdapter.capabilities", () => {
  it("reports the splitter's limit and no threads", () => {
    const c = new BuzzAdapter({
      baseUrl: "https://chat.test/",
      token: "t",
      workspaceId: "w",
      botUserId: "b",
    }).capabilities;
    expect(c.maxMessageChars).toBe(BUZZ_MESSAGE_LIMIT);
    expect(c.threads).toBe(false);
  });
});
