/**
 * Tests for normalizeSlackEvent — channel type mapping, bot loop guard,
 * mention guard (D285), thread topicId.
 */

import { describe, expect, it } from "vitest";
import { type BoltMessageBody, normalizeSlackEvent } from "../src/normalize.js";

const BOT = "UBOT1234";

function mkBody(
  event: Partial<BoltMessageBody["event"]> & { ts: string; channel: string },
): BoltMessageBody {
  return {
    team_id: "T123",
    event: {
      type: "message",
      ...event,
    },
  };
}

describe("normalizeSlackEvent — receivedAt", () => {
  /**
   * `receivedAt: Math.floor(Number(e.ts) * 1000)` is the only field this
   * normalizer COMPUTES — every other one is a passthrough, and every other one
   * is asserted. This had no assertion anywhere in the repository: a grep for
   * `receivedAt` across `packages/*​/tests` returned no Slack hit at all, and
   * the fixture's `ts: "100.1"` appeared only as a substring of an event id.
   *
   * Drop the `* 1000` and `receivedAt` becomes a 1970 timestamp, silently
   * breaking every freshness and ordering consumer downstream, with the suite
   * green.
   */
  it("converts Slack's float seconds into epoch milliseconds", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "D1",
        ts: "1700000000.000100",
        user: "U1",
        text: "hi",
        channel_type: "im",
      }),
      BOT,
      { requireMention: false },
    );
    expect(r?.receivedAt).toBe(1_700_000_000_000);
  });

  it("keeps millisecond precision rather than truncating to the second", () => {
    // Slack's ts carries microseconds. Rounding to whole seconds would collapse
    // the ordering of messages sent inside the same second.
    const r = normalizeSlackEvent(
      mkBody({
        channel: "D1",
        ts: "1700000000.250000",
        user: "U1",
        text: "hi",
        channel_type: "im",
      }),
      BOT,
      { requireMention: false },
    );
    expect(r?.receivedAt).toBe(1_700_000_000_250);
  });

  it("produces a plausible epoch-millisecond value, not seconds", () => {
    // The regression this guards is off by a factor of 1000, which is easy to
    // miss when reading a bare number. 1e12 is the floor for any date after 2001.
    const r = normalizeSlackEvent(
      mkBody({
        channel: "D1",
        ts: "1700000000.000000",
        user: "U1",
        text: "hi",
        channel_type: "im",
      }),
      BOT,
      { requireMention: false },
    );
    expect(r?.receivedAt).toBeGreaterThan(1_000_000_000_000);
  });

  it("preserves the raw ts alongside the converted value", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "D1",
        ts: "1700000000.000100",
        user: "U1",
        text: "hi",
        channel_type: "im",
      }),
      BOT,
      { requireMention: false },
    );
    // Consumers that need Slack's own identifier (thread replies, reactions)
    // depend on the untouched string.
    expect(r?.slack.ts).toBe("1700000000.000100");
  });
});

describe("normalizeSlackEvent — channel types (D270, D271)", () => {
  it("DM → channel.type = dm", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "D1", ts: "100.1", user: "U1", text: "hi", channel_type: "im" }),
      BOT,
      { requireMention: false },
    );
    expect(r?.channel.type).toBe("dm");
    expect(r?.channel.topicId).toBeUndefined();
  });

  it("public channel mention → channel.type = group", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: `<@${BOT}> hello`,
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r?.channel.type).toBe("group");
  });

  it("mpim (multi-DM) → channel.type = group", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "G1", ts: "100.1", user: "U1", text: "hi", channel_type: "mpim" }),
      BOT,
    );
    expect(r?.channel.type).toBe("group");
  });

  it("thread reply → channel.type = thread + topicId = thread_ts (D271)", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "200.1",
        thread_ts: "100.1",
        user: "U1",
        text: "follow-up",
        channel_type: "channel",
      }),
      BOT,
      { requireMention: false },
    );
    expect(r?.channel.type).toBe("thread");
    expect(r?.channel.topicId).toBe("100.1");
    expect(r?.slack.threadTs).toBe("100.1");
  });
});

describe("normalizeSlackEvent — bot loop guard (D275)", () => {
  it("drops messages where user equals botUserId", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "D1", ts: "100.1", user: BOT, text: "self echo", channel_type: "im" }),
      BOT,
    );
    expect(r).toBeUndefined();
  });

  it("drops bot_message subtype", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        bot_id: "B1",
        subtype: "bot_message",
        text: "from another bot",
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r).toBeUndefined();
  });

  it("drops ANOTHER bot's thread broadcast, which is the loop the guard is named for", () => {
    // Found by mutation testing on 2026-08-30. Every mutant of the `bot_id` guard survived, and
    // the reason was worse than a missing test: the guard is `bot_id !== undefined && subtype ===
    // "bot_message"`, and the NEXT line already drops every subtype except `thread_broadcast`. So
    // the guard was subsumed — deleting the whole line left all 78 tests green — and the one case
    // it did not cover is the one it was written for.
    //
    // `thread_broadcast` is deliberately allowed through, because a human broadcasting a thread
    // reply is a real message. A BOT broadcasting one is not, and it arrived at the handler. Two
    // agents in the same channel, both replying with broadcast, answer each other forever.
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        bot_id: "B_OTHER",
        subtype: "thread_broadcast",
        thread_ts: "99.1",
        text: `<@${BOT}> what do you think?`,
        channel_type: "channel",
      }),
      BOT,
    );

    expect(r, "another bot's broadcast reached the handler").toBeUndefined();
  });

  it("keeps a HUMAN thread broadcast, which is what the allowance is for", () => {
    // The other side of the same guard: widening it to drop every message carrying `bot_id` must
    // not cost the case `thread_broadcast` was allowed through for.
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U_HUMAN",
        subtype: "thread_broadcast",
        thread_ts: "99.1",
        text: `<@${BOT}> what do you think?`,
        channel_type: "channel",
      }),
      BOT,
    );

    expect(r?.text).toContain("what do you think?");
  });

  it("drops edited messages and other non-user subtypes", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: "edited",
        subtype: "message_changed",
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r).toBeUndefined();
  });

  it("keeps thread_broadcast subtype (legit reply broadcast)", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "200.1",
        thread_ts: "100.1",
        user: "U1",
        text: `<@${BOT}> shared back to channel`,
        subtype: "thread_broadcast",
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r).toBeDefined();
    expect(r?.slack.subtype).toBe("thread_broadcast");
  });
});

describe("normalizeSlackEvent — mention guard (D285 / EC-3)", () => {
  it("default requireMention=true drops public-channel msg without @bot", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: "just chatting",
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r).toBeUndefined();
  });

  it("default requireMention=true KEEPS public-channel msg WITH @bot", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: `<@${BOT}> please help`,
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r).toBeDefined();
  });

  it("requireMention=false keeps all channel messages", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: "just chatting",
        channel_type: "channel",
      }),
      BOT,
      { requireMention: false },
    );
    expect(r).toBeDefined();
  });

  it("DM always passes regardless of mention", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "D1",
        ts: "100.1",
        user: "U1",
        text: "no mention needed in DM",
        channel_type: "im",
      }),
      BOT,
    );
    expect(r).toBeDefined();
  });

  it("mpim always passes regardless of mention", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "G1",
        ts: "100.1",
        user: "U1",
        text: "group dm",
        channel_type: "mpim",
      }),
      BOT,
    );
    expect(r).toBeDefined();
  });
});

describe("normalizeSlackEvent — misc", () => {
  it("returns undefined for non-message event types", () => {
    const r = normalizeSlackEvent(
      // biome-ignore lint/suspicious/noExplicitAny: synthesizing a non-message event
      { team_id: "T", event: { type: "reaction_added", ts: "100", channel: "C1" } as any },
      BOT,
    );
    expect(r).toBeUndefined();
  });

  it("uses 'anonymous' when event.user is absent", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "D1", ts: "100.1", text: "hi", channel_type: "im" }),
      BOT,
    );
    expect(r?.sender.id).toBe("anonymous");
    expect(r?.slack.userId).toBe("anonymous");
  });

  it("EC-7: file-only message kept with text: ''", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "D1", ts: "100.1", user: "U1", channel_type: "im" }),
      BOT,
    );
    expect(r).toBeDefined();
    expect(r?.text).toBe("");
  });

  it("sender id matches userId field", () => {
    const r = normalizeSlackEvent(
      mkBody({ channel: "D1", ts: "100.1", user: "U42", text: "hi", channel_type: "im" }),
      BOT,
    );
    expect(r?.sender.id).toBe("U42");
    expect(r?.slack.userId).toBe("U42");
  });

  it("sets stable id of form slack-<team>-<channel>-<ts>", () => {
    const r = normalizeSlackEvent(
      mkBody({
        channel: "C1",
        ts: "100.1",
        user: "U1",
        text: `<@${BOT}>`,
        channel_type: "channel",
      }),
      BOT,
    );
    expect(r?.id).toBe("slack-T123-C1-100.1");
  });
});
