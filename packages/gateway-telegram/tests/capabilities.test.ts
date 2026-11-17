/** TelegramAdapter.capabilities — what an app can rely on when it renders for Telegram. */

import { describe, expect, it } from "vitest";

import { TelegramAdapter } from "../src/adapter.js";
import { TELEGRAM_MAX_MESSAGE } from "../src/split.js";

describe("TelegramAdapter.capabilities", () => {
  it("reports image and audio, edit, typing and reactions", () => {
    const c = new TelegramAdapter({ token: "fake:token" }).capabilities;
    expect(c.attachments).toEqual(["image", "audio"]);
    expect(c.edit).toBe(true);
    expect(c.typing).toBe(true);
    expect(c.reactions).toBe(true);
  });
});

describe("TelegramAdapter.capabilities limits", () => {
  it("reports the splitter limit and threads", () => {
    const c = new TelegramAdapter({ token: "fake:token" }).capabilities;
    expect(c.maxMessageChars).toBe(TELEGRAM_MAX_MESSAGE);
    expect(c.threads).toBe(true);
  });
});
