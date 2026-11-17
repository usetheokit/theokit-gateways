import { describe, expect, it } from "vitest";

import { GatewayConfigurationError } from "../../src/errors/config-error.js";
import { scopedStrategy } from "../../src/session/scoped-strategy.js";
import type { MessageEvent } from "../../src/types/message-event.js";

function ev(
  platform: "telegram" | "slack",
  channel: MessageEvent["channel"],
  senderId = "100",
): MessageEvent {
  return {
    id: "x",
    platform,
    sender: { id: senderId },
    channel,
    text: "",
    receivedAt: 0,
  } as unknown as MessageEvent;
}
const dm = (p: "telegram" | "slack", s = "100") => ev(p, { type: "dm", id: "c" }, s);
const peerLinks = new Map([
  ["telegram:100", "ana"],
  ["slack:U1", "ana"],
]);

describe("scopedStrategy", () => {
  it("produces the documented DM key per scope", () => {
    expect(scopedStrategy({ dmScope: "main" })(dm("telegram"))).toBe("@main:dm");
    expect(scopedStrategy({ dmScope: "per-channel-peer" })(dm("telegram"))).toBe("telegram:dm:100");
    expect(scopedStrategy({ dmScope: "per-peer", peerLinks })(dm("telegram"))).toBe("@peer:dm:ana");
    expect(
      scopedStrategy({ dmScope: "per-account-channel-peer", accountLabel: "bot-1" })(
        dm("telegram"),
      ),
    ).toBe("telegram:dm:bot-1:100");
  });

  it("groups and topic threads ignore dmScope", () => {
    const group = ev("telegram", { type: "group", id: "g-1" });
    const thread = ev("telegram", { type: "thread", id: "g-1", topicId: "t" });
    const bare = ev("telegram", { type: "thread", id: "g-1" });
    for (const dmScope of [
      "main",
      "per-peer",
      "per-channel-peer",
      "per-account-channel-peer",
    ] as const) {
      const s = scopedStrategy({ dmScope, accountLabel: "a" });
      expect(s(group)).toBe("telegram:grp:g-1");
      expect(s(thread)).toBe("telegram:tpc:g-1:t");
      expect(s(bare)).toBe("telegram:grp:g-1");
    }
    expect(scopedStrategy({ dmScope: "main", groupScope: "channel-sender" })(group)).toBe(
      "telegram:grp:g-1:100",
    );
  });

  it("per-peer links across platforms and falls back when unlinked", () => {
    const s = scopedStrategy({ dmScope: "per-peer", peerLinks });
    expect(s(dm("slack", "U1"))).toBe(s(dm("telegram")));
    expect(s(dm("slack", "U2"))).toBe("slack:dm:U2");
  });

  it("gives a-b and a_b different keys under every scope", () => {
    for (const dmScope of [
      "main",
      "per-peer",
      "per-channel-peer",
      "per-account-channel-peer",
    ] as const) {
      const s = scopedStrategy({ dmScope, accountLabel: "x" });
      const group = scopedStrategy({ dmScope, accountLabel: "x", groupScope: "channel-sender" });
      const g = (id: string) => group(ev("telegram", { type: "group", id: "g" }, id));
      expect(g("a-b")).not.toBe(g("a_b"));
      if (dmScope !== "main") expect(s(dm("telegram", "a-b"))).not.toBe(s(dm("telegram", "a_b")));
    }
  });

  it("keeps DM keys apart from group keys", () => {
    const s = scopedStrategy({ dmScope: "per-account-channel-peer", accountLabel: "grp-x" });
    expect(s(dm("telegram"))).not.toBe(s(ev("telegram", { type: "group", id: "x" })));
  });

  it("keeps a linked peer apart from an unlinked sender on a platform named peer", () => {
    const s = scopedStrategy({ dmScope: "per-peer", peerLinks });
    const linked = s(dm("telegram"));
    const unlinked = s(ev("peer" as "slack", { type: "dm", id: "c" }, "ana"));
    expect(linked).not.toBe(unlinked);
  });

  it("keeps platform foo-dm apart from platform foo with dm-like ids", () => {
    const s = scopedStrategy({ dmScope: "per-channel-peer" });
    const a = s(ev("foo-dm" as "slack", { type: "dm", id: "c" }, "x"));
    const b = s(ev("foo" as "slack", { type: "dm", id: "c" }, "dm-x"));
    expect(a).not.toBe(b);
  });

  it("separates DM, group and thread keys with a hyphenated platform", () => {
    const p = "my-platform" as "slack";
    const s = scopedStrategy({ dmScope: "per-channel-peer", groupScope: "channel-sender" });
    const keys = [
      s(ev(p, { type: "dm", id: "c" }, "u")),
      s(ev(p, { type: "group", id: "u" }, "u")),
      s(ev(p, { type: "thread", id: "u", topicId: "u" }, "u")),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it("validates options when called", () => {
    for (const accountLabel of [undefined, ""]) {
      try {
        scopedStrategy({ dmScope: "per-account-channel-peer", accountLabel });
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(GatewayConfigurationError);
        expect((e as GatewayConfigurationError).code).toBe("invalid_session_scope");
        expect((e as Error).message).toContain("accountLabel");
      }
    }
    expect(() =>
      scopedStrategy({ dmScope: "per-peer", peerLinks: new Map([["telegram:1", ""]]) }),
    ).toThrow(GatewayConfigurationError);
  });
});
