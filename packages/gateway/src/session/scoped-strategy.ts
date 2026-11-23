/**
 * `scopedStrategy` — session keys with DM scopes, peer links and account labels.
 *
 * `dm` is always the second key segment, so no label or peer name can make a
 * DM key equal a group (`grp`) or thread (`tpc`) key. Every segment is encoded
 * with `encodeURIComponent` and joined with `:`, which it never emits, so the
 * key mapping is injective. Linked peers and `main` use a leading `@` segment,
 * which no encoded platform can start with (`@` encodes to `%40`).
 *
 * @public
 */

import { GatewayConfigurationError } from "../errors/config-error.js";
import type { MessageEvent as GatewayMessageEvent } from "../types/message-event.js";
import { type AgentIdStrategy, sanitize } from "./router.js";

/** How DMs are keyed: one conversation, per peer, per channel and peer, or per account too. */
export type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";

/** Options for {@link scopedStrategy}. */
export interface ScopedStrategyOptions {
  readonly dmScope: DmScope;
  /** `<platform>:<senderId>` to a peer name. Used by `per-peer`. */
  readonly peerLinks?: ReadonlyMap<string, string>;
  /** Required when `dmScope` is `per-account-channel-peer`. */
  readonly accountLabel?: string;
  /** Group key: one per channel (default) or one per channel and sender. */
  readonly groupScope?: "channel" | "channel-sender";
  /**
   * Overrides the `main` and linked-peer DM keys so an app can keep the keys
   * its stored sessions already use. `peer` receives the raw (unescaped) peer
   * name. The caller owns uniqueness: a custom key can collide with other keys.
   */
  readonly keys?: {
    readonly main?: string;
    readonly peer?: (name: string) => string;
  };
}

const join = (...segments: readonly string[]): string => segments.map(sanitize).join("-");

function invalid(message: string, detail?: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway", {
    code: "invalid_session_scope",
    message: `gateway: invalid_session_scope: ${message}`,
    ...(detail === undefined ? {} : { detail }),
  });
}

/**
 * Builds a strategy for the chosen DM scope. Keys:
 * `main` → `_m-dm`; `per-peer` linked → `_p-dm-<peer>`, unlinked → the
 * per-channel-peer key; `per-channel-peer` → `<platform>-dm-<sender>`;
 * `per-account-channel-peer` → `<platform>-dm-<account>-<sender>`.
 * Groups are `<platform>-grp-<channel>[-<sender>]`, topic threads
 * `<platform>-tpc-<channel>-<topic>`. Every segment is escaped with `sanitize`.
 * `keys` replaces the `main` and linked-peer formats. A throwing `keys.peer` throws per event.
 * Throws `GatewayConfigurationError` (`invalid_session_scope`) on bad options, never per event.
 */
export function scopedStrategy(options: ScopedStrategyOptions): AgentIdStrategy {
  const { dmScope, peerLinks, accountLabel, groupScope = "channel", keys } = options;
  if (
    dmScope === "per-account-channel-peer" &&
    (accountLabel === undefined || accountLabel === "")
  ) {
    throw invalid("per-account-channel-peer requires a non-empty accountLabel", "accountLabel");
  }
  if (peerLinks !== undefined) {
    for (const [from, peer] of peerLinks) {
      if (peer === "") throw invalid(`empty peer name for ${from}`, from);
    }
  }

  const dmKey = (platform: string, senderId: string): string => {
    switch (dmScope) {
      case "main":
        return keys?.main ?? "_m-dm";
      case "per-peer": {
        const peer = peerLinks?.get(`${platform}:${senderId}`);
        if (peer === undefined) return join(platform, "dm", senderId);
        return keys?.peer === undefined ? `_p-dm-${sanitize(peer)}` : keys.peer(peer);
      }
      case "per-channel-peer":
        return join(platform, "dm", senderId);
      case "per-account-channel-peer":
        return join(platform, "dm", accountLabel ?? "", senderId);
    }
  };

  return (event: GatewayMessageEvent): string => {
    const { platform, channel, sender } = event;
    if (channel.type === "dm") return dmKey(platform, sender.id);
    if (channel.type === "thread" && channel.topicId !== undefined) {
      return join(platform, "tpc", channel.id, channel.topicId);
    }
    return groupScope === "channel-sender"
      ? join(platform, "grp", channel.id, sender.id)
      : join(platform, "grp", channel.id);
  };
}
