/**
 * Group-chat policy for Telegram bots (T5.1).
 *
 * In private chats: respond to everything.
 * In groups: respond only when:
 *  1. the user @-mentions the bot OR
 *  2. the message is a reply to one of the bot's earlier messages OR
 *  3. it's a slash command (Telegram auto-routes those to the bot).
 *
 * Without this filter, a Telegram bot in a group becomes a noisemaker.
 * Register as a `pre_inbound` hook on the runner.
 *
 * @public
 */

import type { Context } from "grammy";

/** Policy state. Build once per bot at boot from `bot.botInfo`. */
export interface PolicyContext {
  /** The bot's username (without leading `@`). */
  readonly botUsername: string;
  /** The bot's user id. Used to detect reply-to-bot. */
  readonly botId: number;
}

/** The message facts the policy reads, as plain values (no grammy `Context`). */
export interface PolicyInput {
  /** Telegram chat type: `private`, `group`, `supergroup` or `channel`. */
  readonly chatType: string;
  /** Message text or caption; empty when there is none. */
  readonly text: string;
  /** Id of the sender of the message being replied to, when it is a reply. */
  readonly replyToFromId?: number | undefined;
}

/**
 * Decide from plain values whether the bot should respond. Works without a grammy `Context`.
 * @public
 */
export function shouldRespond(input: PolicyInput, policy: PolicyContext): boolean {
  if (input.chatType === "private") return true;
  if (input.text.startsWith("/")) return true;
  if (input.replyToFromId !== undefined && input.replyToFromId === policy.botId) return true;
  return input.text.toLowerCase().includes(`@${policy.botUsername.toLowerCase()}`);
}

/**
 * Decide whether the bot should respond to this update.
 * @public
 */
export function shouldRespondInChat(ctx: Context, policy: PolicyContext): boolean {
  const chat = ctx.chat;
  if (chat === undefined) return false;
  return shouldRespond(
    {
      chatType: chat.type,
      text: ctx.message?.text ?? ctx.message?.caption ?? "",
      replyToFromId: ctx.message?.reply_to_message?.from?.id,
    },
    policy,
  );
}

/** Strip the bot's @-mention from a message so the LLM doesn't see it. @public */
export function stripBotMention(text: string, botUsername: string): string {
  const regex = new RegExp(`@${botUsername}`, "gi");
  return text.replace(regex, "").trim();
}
