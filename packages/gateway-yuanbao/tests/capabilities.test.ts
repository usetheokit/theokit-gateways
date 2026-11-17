import { describe, expect, it } from "vitest";

import { YUANBAO_MESSAGE_LIMIT, YuanbaoAdapter } from "../src/index.js";

describe("YuanbaoAdapter.capabilities", () => {
  it("reports the splitter's limit and no threads", () => {
    const c = new YuanbaoAdapter({ appId: "a", appSecret: "s", callbackSecret: "c" }).capabilities;
    expect(c.maxMessageChars).toBe(YUANBAO_MESSAGE_LIMIT);
    expect(c.threads).toBe(false);
  });
});
