/**
 * `nostr`, `feishu_lark`, `synology_chat`, `tlon_urbit` and `twitch` are first-party platforms
 * (B-359 to B-363, plan ADRs D1 and D2).
 *
 * These assertions run under `tsc`, which the package's `test` script runs before vitest: an
 * assignment that does not type-check fails the suite even though vitest itself strips types.
 */

import { describe, expect, it } from "vitest";

import type {
  FeishuLarkMessageEvent,
  MessageEvent,
  NostrMessageEvent,
  PlatformName,
  SynologyChatMessageEvent,
  TlonUrbitMessageEvent,
  TwitchMessageEvent,
} from "../../src/index.js";

const BASE = {
  sender: { id: "sender" },
  channel: { id: "channel", type: "dm" },
  text: "hi",
  receivedAt: 0,
} as const;

function makeEvents(): readonly MessageEvent[] {
  return [
    {
      ...BASE,
      id: "n1",
      platform: "nostr",
      nostr: { pubkey: "ab".repeat(32), kind: 14, createdAt: 1_700_000_000, raw: {} },
    },
    {
      ...BASE,
      id: "f1",
      platform: "feishu_lark",
      feishu_lark: { chatId: "oc_1", messageId: "om_1", openId: "ou_1", eventId: "ev_1", raw: {} },
    },
    {
      ...BASE,
      id: "s1",
      platform: "synology_chat",
      synology_chat: { userId: 42, username: "alice", postId: "p1", timestamp: 1, raw: {} },
    },
    {
      ...BASE,
      id: "t1",
      platform: "tlon_urbit",
      tlon_urbit: { ship: "~zod", messageId: "~zod/1", sent: 1, raw: {} },
    },
    {
      ...BASE,
      id: "w1",
      platform: "twitch",
      twitch: {
        broadcasterUserId: "1",
        chatterUserId: "2",
        chatterLogin: "viewer",
        messageId: "m1",
        raw: {},
      },
    },
  ];
}

describe("nostr, feishu_lark, synology_chat, tlon_urbit and twitch events", () => {
  it("names each of them as a platform", () => {
    const names: readonly PlatformName[] = [
      "nostr",
      "feishu_lark",
      "synology_chat",
      "tlon_urbit",
      "twitch",
    ];

    // The assertion that matters is the annotation above, which `tsc` checks; this line only
    // keeps the array from being an unused binding.
    expect(names).toHaveLength(5);
  });

  it("narrows each event to its own variant on the discriminator", () => {
    const fields: string[] = [];
    for (const event of makeEvents()) {
      switch (event.platform) {
        case "nostr": {
          const narrowed: NostrMessageEvent = event;
          fields.push(`${narrowed.nostr.kind}`);
          break;
        }
        case "feishu_lark": {
          const narrowed: FeishuLarkMessageEvent = event;
          fields.push(narrowed.feishu_lark.chatId);
          break;
        }
        case "synology_chat": {
          const narrowed: SynologyChatMessageEvent = event;
          fields.push(`${narrowed.synology_chat.userId}`);
          break;
        }
        case "tlon_urbit": {
          const narrowed: TlonUrbitMessageEvent = event;
          fields.push(narrowed.tlon_urbit.ship);
          break;
        }
        case "twitch": {
          const narrowed: TwitchMessageEvent = event;
          fields.push(narrowed.twitch.chatterLogin);
          break;
        }
        default:
          throw new Error(`unexpected platform ${event.platform}`);
      }
    }

    expect(fields).toEqual(["14", "oc_1", "42", "~zod", "viewer"]);
  });
});
