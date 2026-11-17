/** SlackAdapter.capabilities — the splitter's limit is what the adapter reports. */

import { describe, expect, it } from "vitest";

import { SlackAdapter } from "../src/adapter.js";
import { SLACK_MAX_TEXT } from "../src/split.js";

describe("SlackAdapter.capabilities", () => {
  it("reports the splitter limit and threads", () => {
    const c = new SlackAdapter({ botToken: "xoxb-x", appToken: "xapp-x" }).capabilities;
    expect(c.maxMessageChars).toBe(SLACK_MAX_TEXT);
    expect(c.threads).toBe(true);
  });
});
