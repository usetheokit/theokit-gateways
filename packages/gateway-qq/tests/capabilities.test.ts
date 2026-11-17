/** QQAdapter.capabilities — the splitter's limit is what the adapter reports. */

import { describe, expect, it } from "vitest";

import { QQ_MESSAGE_LIMIT, QQAdapter } from "../src/adapter.js";

describe("QQAdapter.capabilities", () => {
  it("reports the splitter limit and threads", () => {
    const c = new QQAdapter({ appId: "a", appSecret: "s" }).capabilities;
    expect(c.maxMessageChars).toBe(QQ_MESSAGE_LIMIT);
    expect(c.threads).toBe(false);
  });
});
