import type { BasePlatformAdapter, MessageEvent } from "@theokit/gateway";

/**
 * The id the platform gave the inbound message, which is what `react` takes: `event.id` is the
 * gateway's own id (for Telegram `tg-<chat>-<message>`). Falls back to `event.id` for a platform
 * whose payload carries none of the known fields.
 */
export function inboundMessageId(event: MessageEvent): string {
  const payload = (event as unknown as Record<string, unknown>)[event.platform];
  if (typeof payload === "object" && payload !== null) {
    const { messageId, ts } = payload as { messageId?: unknown; ts?: unknown };
    if (typeof messageId === "number" || (typeof messageId === "string" && messageId !== "")) {
      return String(messageId);
    }
    if (typeof ts === "string" && ts !== "") return ts;
  }
  return event.id;
}

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
    await adapter.react(event.channel.id, inboundMessageId(event), emoji);
  } catch {
    /* best effort */
  }
}
