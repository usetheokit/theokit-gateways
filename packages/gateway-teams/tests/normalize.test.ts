/**
 * Normalize tests (T2.3 + EC-3, EC-4, EC-9).
 */

import { describe, expect, it } from "vitest";

import { normalizeTeamsActivity, stripTeamsMentions } from "../src/normalize.js";

describe("normalizeTeamsActivity — channel mapping (D318)", () => {
  it("test_normalize_personal_chat_to_dm", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      text: "hi",
      conversation: { id: "conv-1", conversationType: "personal" },
      from: { id: "u1" },
      timestamp: "2026-05-23T12:00:00.000Z",
    });
    expect(e.channel.type).toBe("dm");
    expect(e.channel.id).toBe("conv-1");
    expect(e.teams.conversationType).toBe("personal");
  });

  it("test_normalize_group_chat_to_group", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "conv-g", conversationType: "groupChat" },
      from: { id: "u1" },
    });
    expect(e.channel.type).toBe("group");
    expect(e.channel.topicId).toBeUndefined();
  });

  it("test_normalize_channel_post_to_group_with_topic", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "conv-c", conversationType: "channel" },
      from: { id: "u1" },
      channelData: {
        channel: { id: "ch-1" },
        team: { id: "team-1" },
      },
    });
    expect(e.channel.type).toBe("group");
    expect(e.channel.topicId).toBe("ch-1");
    expect(e.teams.channelId).toBe("ch-1");
    expect(e.teams.teamId).toBe("team-1");
  });

  it("reads the flat teamsChannelId when the nested channel object is absent", () => {
    // Teams sends the channel id in two shapes and the mapper reads both. Only the nested one had
    // a test, so `?? channelData?.teamsChannelId` — the whole point of the `??` — was unpinned.
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "conv-c", conversationType: "channel" },
      from: { id: "u1" },
      channelData: { teamsChannelId: "ch-flat", teamsTeamId: "team-flat" },
    });

    expect(e.channel.topicId).toBe("ch-flat");
    expect(e.teams.channelId).toBe("ch-flat");
    expect(e.teams.teamId).toBe("team-flat");
  });

  it("keeps a channel post a group even when it carries no channel data at all", () => {
    // The ternary's other arm: with no id in either shape there is no topic, and the event must
    // still be a group rather than gaining a `topicId: undefined` key or falling back to dm.
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "conv-c", conversationType: "channel" },
      from: { id: "u1" },
    });

    expect(e.channel.type).toBe("group");
    expect(e.channel.topicId).toBeUndefined();
  });

  it("survives an activity with no conversation key whatsoever", () => {
    // Every existing case supplies `conversation`, so the optional chaining that guards its absence
    // — in the type mapping AND in the id fallback — was never exercised. A `typing` or
    // `conversationUpdate` activity is where it arrives.
    const e = normalizeTeamsActivity({ type: "message", id: "act-1", from: { id: "u1" } });

    expect(e.channel.type).toBe("dm");
    expect(e.channel.id).toBe("unknown");
    expect(e.teams.conversationId).toBe("unknown");
  });

  it("test_normalize_unknown_conversation_type_defaults_to_dm (EC-3)", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "conv-?", conversationType: "future-type" },
      from: { id: "u1" },
    });
    expect(e.channel.type).toBe("dm");
  });

  it("conversationType undefined entirely falls back to dm without crash (EC-3)", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "conv-?" },
      from: { id: "u1" },
    });
    expect(e.channel.type).toBe("dm");
  });
});

describe("normalizeTeamsActivity — sender fallback chain (EC-4)", () => {
  it("test_normalize_sender_uses_from_id_when_present", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
      from: { id: "from-1", name: "Alice", aadObjectId: "aad-1" },
    });
    expect(e.sender.id).toBe("from-1");
    expect(e.sender.displayName).toBe("Alice");
  });

  it("test_normalize_sender_falls_back_to_aad (EC-4)", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
      from: { aadObjectId: "aad-1" },
    });
    expect(e.sender.id).toBe("aad-1");
  });

  it("test_normalize_sender_anonymous_when_no_id (EC-4)", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
    });
    expect(e.sender.id).toBe("anonymous");
  });
});

describe("normalizeTeamsActivity — preserves raw + timestamp", () => {
  it("test_normalize_preserves_raw_activity", () => {
    const activity = {
      type: "message",
      id: "act-1",
      text: "hi",
      conversation: { id: "c", conversationType: "personal" },
      from: { id: "u1" },
    };
    const e = normalizeTeamsActivity(activity);
    expect(e.teams.raw).toBe(activity);
  });

  it("test_normalize_handles_empty_text", () => {
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
      from: { id: "u1" },
    });
    expect(e.text).toBe("");
  });

  it("parses a valid timestamp instead of stamping the moment it was read", () => {
    // Only the INVALID timestamp had a test, and it asserts `>= before` — which `Date.now()`
    // satisfies whatever the input was. So the whole parse could have been replaced by
    // `Date.now()` with every test green, and every event would carry the time it was processed
    // rather than the time it was sent. On a queue that backed up, those are hours apart.
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
      from: { id: "u1" },
      timestamp: "2026-08-30T12:00:00.000Z",
    });

    expect(e.receivedAt).toBe(Date.parse("2026-08-30T12:00:00.000Z"));
  });

  it("falls back to now when the activity carries no timestamp at all", () => {
    const before = Date.now();
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
      from: { id: "u1" },
    });

    expect(e.receivedAt).toBeGreaterThanOrEqual(before);
  });

  it("names the missing pieces rather than leaving them undefined", () => {
    // `act.id ?? "unknown"` and `conversationType ?? "personal"`. Both fallbacks were free: no case
    // omitted either field, and an event whose activityId is `undefined` breaks a consumer that
    // keys on it — quietly, at the consumer, far from here.
    const e = normalizeTeamsActivity({ conversation: { id: "c" }, from: { id: "u1" } });

    expect(e.teams.activityId).toBe("unknown");
    expect(e.teams.conversationType).toBe("personal");
  });

  it("uses Date.now when timestamp invalid", () => {
    const before = Date.now();
    const e = normalizeTeamsActivity({
      type: "message",
      id: "act-1",
      conversation: { id: "c", conversationType: "personal" },
      from: { id: "u1" },
      timestamp: "not-a-date",
    });
    expect(e.receivedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("stripTeamsMentions", () => {
  it("test_strip_mentions_removes_at_tags", () => {
    expect(stripTeamsMentions("<at>Bot</at> hi")).toBe("Bot hi");
  });

  it("test_strip_mentions_handles_html_attributes (EC-9)", () => {
    expect(stripTeamsMentions('<at type="user" mri="29:1abc">Bot</at> hi how are you')).toBe(
      "Bot hi how are you",
    );
  });

  it("tolerates more than one space before an attribute", () => {
    // `<at(?:\s+[^>]*)?>`. With `\s` instead of `\s+` the tag stops matching the moment a client
    // emits two spaces, and the raw markup reaches the agent as text — which is what the helper
    // exists to prevent.
    expect(stripTeamsMentions('<at  type="user"  mri="29:1abc">Bot</at> hi')).toBe("Bot hi");
  });

  it("test_strip_mentions_removes_bot_display_name", () => {
    expect(stripTeamsMentions("<at>Bot</at> hello", "Bot")).toBe("hello");
  });

  it("escapes regex special chars in display name", () => {
    expect(stripTeamsMentions("<at>Bot.Co</at> hello", "Bot.Co")).toBe("hello");
  });

  it("collapses whitespace + trims", () => {
    expect(stripTeamsMentions("  <at>Bot</at>    hello   world  ", "Bot")).toBe("hello world");
  });
});
