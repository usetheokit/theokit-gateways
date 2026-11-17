/** XAdapter.capabilities — the splitter's limit is what the adapter reports. */

import { describe, expect, it } from "vitest";

import { X_POST_LIMIT, XAdapter } from "../src/adapter.js";

describe("XAdapter.capabilities", () => {
  it("reports the splitter limit and threads", () => {
    const c = new XAdapter({
      userId: "1",
      username: "@b",
      clientId: "c",
      clientSecret: "s",
      refreshToken: "r",
      allowFrom: ["@a"],
    }).capabilities;
    expect(c.maxMessageChars).toBe(X_POST_LIMIT);
    expect(c.threads).toBe(false);
  });
});
