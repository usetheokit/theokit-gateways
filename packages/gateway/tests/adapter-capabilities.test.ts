/** `BasePlatformAdapter.capabilities` — derived from the members a subclass sets or overrides. */

import { describe, expect, it } from "vitest";

import type { SendResult } from "../src/adapter/base.js";
import { MockAdapter } from "./adapter/mock-adapter.js";

describe("BasePlatformAdapter.capabilities", () => {
  it("reports nothing for a bare subclass", () => {
    const c = new MockAdapter().capabilities;
    expect(c).toEqual({
      edit: false,
      attachments: [],
      typing: false,
      reactions: false,
      threads: false,
    });
    expect(c.maxMessageChars).toBeUndefined();
  });

  it("reports typing, reactions and edit when the subclass provides them", () => {
    class Rich extends MockAdapter {
      override readonly supportsEdit = true;
      override async startTyping(_channelId: string): Promise<void> {}
      override async react(_c: string, _m: string, _e: string): Promise<SendResult> {
        return { ok: true };
      }
    }
    const c = new Rich().capabilities;
    expect(c.typing).toBe(true);
    expect(c.reactions).toBe(true);
    expect(c.edit).toBe(true);
    expect(c.attachments).toEqual([]);
  });

  it("reports image when only supportsAttachments is set", () => {
    class Img extends MockAdapter {
      override readonly supportsAttachments = true;
    }
    expect(new Img().capabilities.attachments).toEqual(["image"]);
  });
});
