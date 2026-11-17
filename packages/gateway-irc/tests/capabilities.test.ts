import { describe, expect, it } from "vitest";

import { IrcAdapter } from "../src/index.js";

describe("IrcAdapter.capabilities", () => {
  it("leaves maxMessageChars undefined, since the limit is in bytes", () => {
    const c = new IrcAdapter({ host: "irc.test", nick: "bot", tls: false, channels: ["#a"] })
      .capabilities;
    expect(c.maxMessageChars).toBeUndefined();
    expect(c.threads).toBe(false);
  });
});
