import { createRequire } from "node:module";
import type { BasePlatformAdapter, GatewayContext, MessageEvent } from "@theokit/gateway";
import { AckReactionUnavailableError } from "./errors.js";

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

function gatewayVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)("@theokit/gateway/package.json") as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

type React = (id: string, emoji: string) => Promise<unknown>;

/** `GatewayContext.react` only exists on gateway 0.20+, so it is read through a local type. */
function ctxReact(ctx: GatewayContext): React | undefined {
  try {
    return (ctx as { react?: React }).react?.bind(ctx);
  } catch {
    return undefined;
  }
}

/**
 * Reacts to the inbound message with `emoji`: through `ctx.react` when present, otherwise
 * through the adapter for the event's platform. When neither exists it throws
 * `AckReactionUnavailableError` (a configuration error, never a silent skip). A refusal or a
 * throw from the reaction itself is swallowed. Typing is not started here; `GatewayRunner`
 * already shows it around every handler call.
 */
export async function ackReaction(
  ctx: GatewayContext,
  event: MessageEvent,
  emoji: string | undefined,
  adapters: ReadonlyArray<BasePlatformAdapter> = [],
): Promise<void> {
  if (emoji === undefined || emoji === "") return;
  const viaCtx = ctxReact(ctx);
  const adapter =
    viaCtx === undefined ? adapters.find((a) => a.platform === event.platform) : undefined;
  if (viaCtx === undefined && adapter === undefined) {
    throw new AckReactionUnavailableError(event.platform, gatewayVersion());
  }
  try {
    if (viaCtx !== undefined) await viaCtx(inboundMessageId(event), emoji);
    else await adapter?.react(event.channel.id, inboundMessageId(event), emoji);
  } catch {
    /* best effort */
  }
}
