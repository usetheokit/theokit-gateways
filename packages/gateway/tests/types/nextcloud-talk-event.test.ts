/**
 * `nextcloud_talk` is a first-party platform (B-358, plan ADR D1).
 *
 * These assertions run under `tsc`, which the package's `test` script runs before vitest: an
 * assignment that does not type-check fails the suite even though vitest itself strips types.
 * The field values are the shape of a Talk bot webhook `Create` body as the Q6 probe received it.
 */

import { describe, expect, it } from "vitest";

import type { MessageEvent, NextcloudTalkMessageEvent, PlatformName } from "../../src/index.js";

function makeTalkEvent(): MessageEvent {
  return {
    id: "6",
    platform: "nextcloud_talk",
    sender: { id: "users/admin", displayName: "admin" },
    channel: { id: "uau7bvcd", type: "group" },
    text: "user answer",
    receivedAt: 0,
    nextcloud_talk: {
      roomToken: "uau7bvcd",
      messageId: "6",
      actorId: "users/admin",
      replyToId: "2",
      raw: { type: "Create" },
    },
  };
}

describe("NextcloudTalkMessageEvent", () => {
  it("names nextcloud_talk as a platform", () => {
    const name: PlatformName = "nextcloud_talk";

    expect(name).toBe("nextcloud_talk");
  });

  it("narrows to the nextcloud_talk variant on its discriminator", () => {
    const event = makeTalkEvent();
    if (event.platform !== "nextcloud_talk") throw new Error("unreachable");
    const narrowed: NextcloudTalkMessageEvent = event;

    expect(narrowed.nextcloud_talk.roomToken).toBe("uau7bvcd");
    expect(narrowed.nextcloud_talk.replyToId).toBe("2");
  });
});
