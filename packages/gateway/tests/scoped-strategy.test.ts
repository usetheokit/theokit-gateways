import { describe, expect, it } from "vitest";

import { GatewayConfigurationError } from "../src/errors/config-error.js";
import { type DmScope, scopedStrategy } from "../src/session/scoped-strategy.js";
import type { MessageEvent } from "../src/types/message-event.js";

function ev(
  platform: string,
  senderId: string,
  type: "dm" | "group" | "thread" = "dm",
  channelId = "C1",
  topicId?: string,
): MessageEvent {
  return {
    id: "x",
    platform,
    sender: { id: senderId },
    channel: { id: channelId, type, ...(topicId === undefined ? {} : { topicId }) },
    text: "",
    receivedAt: 0,
  } as unknown as MessageEvent;
}

const scopes: DmScope[] = ["main", "per-peer", "per-channel-peer", "per-account-channel-peer"];
const make = (dmScope: DmScope, extra = {}) =>
  scopedStrategy({ dmScope, accountLabel: "bot-1", ...extra });

describe("scopedStrategy", () => {
  it("produces the documented DM key for each scope", () => {
    const e = ev("slack", "U-1");
    expect(make("main")(e)).toBe("_m-dm");
    expect(make("per-peer")(e)).toBe("slack-dm-U_d1");
    expect(make("per-channel-peer")(e)).toBe("slack-dm-U_d1");
    expect(make("per-account-channel-peer")(e)).toBe("slack-dm-bot_d1-U_d1");
  });

  it("groups and topic threads ignore dmScope", () => {
    for (const s of scopes) {
      expect(make(s)(ev("slack", "U1", "group"))).toBe("slack-grp-C1");
      expect(make(s)(ev("slack", "U1", "thread", "C1", "t-1"))).toBe("slack-tpc-C1-t_d1");
    }
    expect(make("main", { groupScope: "channel-sender" })(ev("slack", "U1", "group"))).toBe(
      "slack-grp-C1-U1",
    );
  });

  it("per-peer shares a linked sender across platforms", () => {
    const s = scopedStrategy({
      dmScope: "per-peer",
      peerLinks: new Map([
        ["telegram:42", "ana"],
        ["slack:U1", "ana"],
      ]),
    });
    expect(s(ev("telegram", "42"))).toBe(s(ev("slack", "U1")));
    expect(s(ev("slack", "U2"))).toBe("slack-dm-U2");
  });

  it("never collides a linked peer with a platform named like it", () => {
    const s = scopedStrategy({ dmScope: "per-peer", peerLinks: new Map([["a:1", "x"]]) });
    expect(s(ev("a", "1"))).not.toBe(s(ev("_p", "x")));
  });

  it("keeps DM, group and thread keys apart with hyphenated platforms and labels", () => {
    const s = scopedStrategy({
      dmScope: "per-account-channel-peer",
      accountLabel: "grp-x",
      groupScope: "channel-sender",
    });
    const p = "my-platform";
    const keys = [
      s(ev(p, "u", "dm")),
      s(ev(p, "u", "group", "u")),
      s(ev(p, "u", "thread", "u", "u")),
      s(ev("foo-dm", "x")),
      s(ev("foo", "dm-x")),
    ];
    expect(new Set(keys).size).toBe(5);
  });

  it("gives a-b and a_b different keys under every scope", () => {
    for (const s of scopes) {
      const st = make(s);
      // `main` keys every DM as one conversation by design; the sender id
      // still separates keys wherever a key carries it.
      if (s !== "main") expect(st(ev("slack", "a-b"))).not.toBe(st(ev("slack", "a_b")));
      const grp = make(s, { groupScope: "channel-sender" });
      expect(grp(ev("slack", "a-b", "group"))).not.toBe(grp(ev("slack", "a_b", "group")));
    }
    const linked = scopedStrategy({
      dmScope: "per-peer",
      peerLinks: new Map([
        ["slack:a-b", "p-q"],
        ["slack:a_b", "p_q"],
      ]),
    });
    expect(linked(ev("slack", "a-b"))).not.toBe(linked(ev("slack", "a_b")));
  });

  it("throws invalid_session_scope naming accountLabel", () => {
    expect.assertions(3);
    try {
      scopedStrategy({ dmScope: "per-account-channel-peer" });
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayConfigurationError);
      expect((err as GatewayConfigurationError).code).toBe("invalid_session_scope");
      expect((err as Error).message).toContain("accountLabel");
    }
  });

  it("throws for an empty peer name", () => {
    expect(() =>
      scopedStrategy({ dmScope: "per-peer", peerLinks: new Map([["slack:U1", ""]]) }),
    ).toThrow(GatewayConfigurationError);
  });

  it("never throws per event, even for unpaired surrogates", () => {
    const bad = "a\uD800b\uDC00";
    for (const s of scopes) {
      const st = scopedStrategy({
        dmScope: s,
        accountLabel: bad,
        peerLinks: new Map([[`slack:${bad}`, bad]]),
      });
      expect(() => st(ev("slack", bad))).not.toThrow();
      expect(() => st(ev(bad, bad, "group", bad))).not.toThrow();
      expect(() => st(ev("slack", bad, "thread", bad, bad))).not.toThrow();
    }
  });
});
