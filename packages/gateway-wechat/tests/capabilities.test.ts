/** WeChatAdapter.capabilities — the splitter's limit is what the adapter reports. */

import { describe, expect, it } from "vitest";

import { WeChatAdapter } from "../src/adapter.js";
import { WECHAT_MESSAGE_LIMIT } from "../src/split.js";

describe("WeChatAdapter.capabilities", () => {
  it("reports the splitter limit and threads", () => {
    const c = new WeChatAdapter({ appId: "wx1", appSecret: "s", token: "t" }).capabilities;
    expect(c.maxMessageChars).toBe(WECHAT_MESSAGE_LIMIT);
    expect(c.threads).toBe(false);
  });
});
