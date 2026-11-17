import { describe, expect, it } from "vitest";

import { TWITCH_MESSAGE_LIMIT, TwitchAdapter } from "../src/index.js";

describe("TwitchAdapter.capabilities", () => {
  it("reports the splitter's limit and no threads", () => {
    const c = new TwitchAdapter({ accessToken: "t", botUserId: "1", broadcasterUserIds: ["2"] })
      .capabilities;
    expect(c.maxMessageChars).toBe(TWITCH_MESSAGE_LIMIT);
    expect(c.threads).toBe(false);
  });
});
