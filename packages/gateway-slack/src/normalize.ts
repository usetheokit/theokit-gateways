/**
 * Normalize a Slack `message` event (Bolt body) into the canonical
 * `SlackMessageEvent` (ADRs D270, D271, D274, D275, D285).
 *
 * Returns `undefined` for:
 *   - Non-message event types.
 *   - Bot-self messages (D275 loop guard).
 *   - Subtype `bot_message`.
 *   - Edited / channel_join / channel_leave / other non-user subtypes
 *     (only `"thread_broadcast"` is kept among subtypes).
 *   - EC-3 / D285: public-channel messages without an `@bot` mention,
 *     unless `requireMention === false`.
 *
 * @internal
 */

import type { SlackMessageEvent } from "@theokit/gateway";

export interface BoltMessageBody {
  event: {
    type: "message" | string;
    channel: string;
    channel_type?: "im" | "mpim" | "channel" | "group";
    user?: string;
    text?: string;
    ts: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
  };
  team_id?: string;
}

/** Options for {@link normalizeSlackEvent}. */
export interface NormalizeOptions {
  /** D285: when `true` (default), public-channel messages without `@bot` are dropped. */
  readonly requireMention?: boolean;
}

function shouldSkipEvent(e: BoltMessageBody["event"], botUserId: string | undefined): boolean {
  if (e.type !== "message") return true;
  // D275 bot loop guard
  if (e.user !== undefined && botUserId !== undefined && e.user === botUserId) return true;
  // A message from a bot has `bot_id` and NO human author. That pairing is the whole rule, and
  // both halves were learned the hard way on 2026-08-30.
  //
  // The condition was `bot_id !== undefined && subtype === "bot_message"`, which the NEXT line
  // already covers — every subtype but `thread_broadcast` is dropped there — so the guard was dead,
  // and the one case it never reached was a bot's `thread_broadcast`: two agents in a channel, both
  // replying with broadcast, answering each other forever.
  //
  // Widening it to `bot_id !== undefined` alone then over-corrected, and the live suite caught it
  // where no unit test did. `chat.postMessage` with a USER token produces a message authored by the
  // human AND carrying the app's `bot_id` — workflow posts, integrations, anything a person drives
  // through an app. Those are people talking, and they were being dropped.
  if (e.bot_id !== undefined && e.user === undefined) return true;
  // Skip subtypes that aren't user messages — but keep "thread_broadcast".
  if (e.subtype !== undefined && e.subtype !== "thread_broadcast") return true;
  return false;
}

function resolveChannelType(e: BoltMessageBody["event"]): "dm" | "group" | "thread" {
  if (e.thread_ts !== undefined && e.thread_ts !== e.ts) return "thread";
  if (e.channel_type === "im") return "dm";
  return "group";
}

function isMentionGated(
  e: BoltMessageBody["event"],
  channelType: "dm" | "group" | "thread",
  botUserId: string | undefined,
  requireMention: boolean,
): boolean {
  return (
    requireMention &&
    channelType === "group" &&
    e.channel_type === "channel" &&
    botUserId !== undefined &&
    !(e.text ?? "").includes(`<@${botUserId}>`)
  );
}

/**
 * Turn a Bolt message body into a `SlackMessageEvent`, or `undefined` when it should be ignored.
 *
 * Returns `undefined` rather than throwing for every non-message event, for the bot's own messages,
 * and — when `requireMention` is left at its default — for public-channel messages that do not
 * mention the bot. Ignoring is a normal outcome here, not an error.
 */
export function normalizeSlackEvent(
  body: BoltMessageBody,
  botUserId: string | undefined,
  opts: NormalizeOptions = {},
): SlackMessageEvent | undefined {
  const e = body.event;
  if (shouldSkipEvent(e, botUserId)) return undefined;

  const channelType = resolveChannelType(e);
  const requireMention = opts.requireMention ?? true;
  if (isMentionGated(e, channelType, botUserId, requireMention)) return undefined;

  const userId = e.user ?? "anonymous";
  const event: SlackMessageEvent = {
    id: `slack-${body.team_id ?? "?"}-${e.channel}-${e.ts}`,
    platform: "slack",
    sender: { id: userId },
    channel: {
      id: e.channel,
      type: channelType,
      ...(channelType === "thread" && e.thread_ts !== undefined ? { topicId: e.thread_ts } : {}),
    },
    text: e.text ?? "",
    receivedAt: Math.floor(Number(e.ts) * 1000),
    slack: {
      teamId: body.team_id,
      channelId: e.channel,
      userId,
      ts: e.ts,
      ...(e.thread_ts !== undefined ? { threadTs: e.thread_ts } : {}),
      ...(e.subtype !== undefined ? { subtype: e.subtype } : {}),
      raw: body,
    },
  };
  return event;
}
