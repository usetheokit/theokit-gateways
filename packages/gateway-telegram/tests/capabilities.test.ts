/** TelegramAdapter.capabilities — what an app can rely on when it renders for Telegram. */

import { describe, expect, it } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";

describe("TelegramAdapter.capabilities", () => {
  it("reports image and audio, edit, typing and reactions", () => {
    const c = new TelegramAdapter({ token: "fake:token" }).capabilities;
    expect(c.attachments).toEqual(["image", "audio"]);
    expect(c.edit).toBe(true);
    expect(c.typing).toBe(true);
    expect(c.reactions).toBe(true);
  });
});
