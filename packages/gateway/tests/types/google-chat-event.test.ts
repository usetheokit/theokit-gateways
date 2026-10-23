/**
 * `google_chat` is a first-party platform (B-356, plan ADR D1).
 *
 * These assertions run under `tsc`, which the package's `test` script runs before vitest: an
 * assignment that does not type-check fails the suite even though vitest itself strips types.
 */

import { describe, expect, it } from "vitest";

import type { GoogleChatMessageEvent, MessageEvent, PlatformName } from "../../src/index.js";

function makeGoogleChatEvent(): MessageEvent {
  return {
    id: "spaces/AAA/messages/BBB",
    platform: "google_chat",
    sender: { id: "users/123", displayName: "Ana" },
    channel: { id: "spaces/AAA", type: "group" },
    text: "hi",
    receivedAt: 0,
    google_chat: {
      messageName: "spaces/AAA/messages/BBB",
      spaceName: "spaces/AAA",
      spaceType: "SPACE",
      raw: {},
    },
  };
}

describe("GoogleChatMessageEvent", () => {
  it("names google_chat as a platform", () => {
    const name: PlatformName = "google_chat";

    expect(name).toBe("google_chat");
  });

  it("narrows to the google_chat variant on its discriminator", () => {
    const event = makeGoogleChatEvent();
    if (event.platform !== "google_chat") throw new Error("unreachable");
    const narrowed: GoogleChatMessageEvent = event;
    const space: string = narrowed.google_chat.spaceName;

    expect(space).toBe("spaces/AAA");
    expect(narrowed.google_chat.spaceType).toBe("SPACE");
  });
});
