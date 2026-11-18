import type { BasePlatformAdapter, GatewayContext, MessageEvent } from "@theokit/gateway";

/**
 * The id the platform gave the inbound message, which is what `react` takes: `event.id` is the
 * gateway's own id (for Telegram `tg-<chat>-<message>`). Falls back to `event.id` for a platform
 * whose payload carries none of the known fields.
 */
export function inboundMessageId(event: MessageEvent): string {
  const payload = (event as unknown as Record<string, unknown>)[event.platform];
  if (typeof payload !== "object" || payload === null) return event.id;
  const fields = payload as Record<string, unknown>;
  for (const key of ["messageId", "wamid", "ts"]) {
    const value = fields[key];
    if (typeof value === "number" && key === "messageId") return String(value);
    if (typeof value === "string" && value !== "") return value;
  }
  return event.id;
}

/**
 * Reacts to the inbound message with `emoji` through `ctx.react`. Best effort: a missing `react`
 * (older runner, no `adapters` given), a refusal or a throw is swallowed. Typing is not started here; `GatewayRunner`
 * already shows it around every handler call.
 */
export async function ackReaction(
  ctx: GatewayContext,
  event: MessageEvent,
  emoji: string | undefined,
  adapters: ReadonlyArray<BasePlatformAdapter> = [],
): Promise<void> {
  if (emoji === undefined || emoji === "") return;
  try {
    if (ctx.react !== undefined) {
      await ctx.react(inboundMessageId(event), emoji);
      return;
    }
    // Gateway 0.20.x contexts have no `react`: go through the adapter for the event's platform.
    const adapter = adapters.find((a) => a.platform === event.platform);
    await adapter?.react(event.channel.id, inboundMessageId(event), emoji);
  } catch {
    /* best effort */
  }
}
