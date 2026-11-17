import { describe, expect, it } from "vitest";

import { WECOM_MESSAGE_LIMIT, WeComAdapter } from "../src/index.js";

describe("WeComAdapter.capabilities", () => {
  it("reports the splitter's limit and no threads", () => {
    const c = new WeComAdapter({
      corpId: "c",
      corpSecret: "s",
      agentId: 1,
      token: "t",
      encodingAesKey: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
    }).capabilities;
    expect(c.maxMessageChars).toBe(WECOM_MESSAGE_LIMIT);
    expect(c.threads).toBe(false);
  });
});
