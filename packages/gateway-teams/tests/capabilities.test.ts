/** TeamsAdapter.capabilities — the splitter's limit is what the adapter reports. */

import { describe, expect, it } from "vitest";

import { TeamsAdapter } from "../src/adapter.js";
import { TEAMS_MAX_TEXT } from "../src/split.js";

describe("TeamsAdapter.capabilities", () => {
  it("reports the splitter limit and threads", () => {
    const c = new TeamsAdapter({ clientId: "c", clientSecret: "s", tenantId: "t" }).capabilities;
    expect(c.maxMessageChars).toBe(TEAMS_MAX_TEXT);
    expect(c.threads).toBe(false);
  });
});
