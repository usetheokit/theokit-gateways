/**
 * Mention reading for the `requireMention` gate (brief FR-006, FR-008).
 *
 * The normalizer strips mention text, so only the raw activity still shows who was mentioned.
 */

interface MentionShape {
  recipient?: { id?: string };
  entities?: ReadonlyArray<{ type?: string; mentioned?: { id?: string } }>;
}

/** Written once per adapter, the first time a group message is dropped for want of a recipient. */
export const NO_RECIPIENT_WARNING =
  "[teams] dropping group messages: requireMention is on and the activity names no recipient id\n";

/**
 * Whether a raw Teams activity mentions its own recipient: `"no_recipient"` when the activity
 * names no `recipient.id` (the bot cannot be told from anyone else), else `"mentioned"` when a
 * `mention` entity carries that id, else `"unmentioned"`.
 */
export function readBotMention(raw: unknown): "mentioned" | "unmentioned" | "no_recipient" {
  const act = (raw ?? {}) as MentionShape;
  const botId = act.recipient?.id;
  if (botId === undefined) return "no_recipient";
  const mentioned = (act.entities ?? []).some(
    (e) => e.type === "mention" && e.mentioned?.id === botId,
  );
  return mentioned ? "mentioned" : "unmentioned";
}
