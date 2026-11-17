import type { BasePlatformAdapter, MessageEvent } from "@theokit/gateway";

/**
 * Reacts to the inbound message with `emoji`. Best effort: a refusal or a throw is swallowed.
 * Typing is not started here; `GatewayRunner` already shows it around every handler call.
 */
export async function ackReaction(
  adapter: BasePlatformAdapter | undefined,
  event: MessageEvent,
  emoji: string | undefined,
): Promise<void> {
  if (adapter === undefined || emoji === undefined || emoji === "") return;
  try {
    await adapter.react(event.channel.id, event.id, emoji);
  } catch {
    /* best effort */
  }
}
