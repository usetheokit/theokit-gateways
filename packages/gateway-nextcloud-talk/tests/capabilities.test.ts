import { describe, expect, it } from "vitest";

import { NextcloudTalkAdapter, TALK_MAX_LENGTH } from "../src/index.js";

describe("NextcloudTalkAdapter.capabilities", () => {
  it("reports the splitter's limit and no threads", () => {
    const c = new NextcloudTalkAdapter({
      baseUrl: "https://cloud.example.com",
      secret: "a-bot-secret-of-forty-or-more-characters-0123456789",
    }).capabilities;
    expect(c.maxMessageChars).toBe(TALK_MAX_LENGTH);
    expect(c.threads).toBe(false);
  });
});
