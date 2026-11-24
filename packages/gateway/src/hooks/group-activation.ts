/**
 * `groupActivationHook` — blocks group messages that did not address the bot, per chat.
 *
 * @public
 */

import type { GatewayHook } from "./types.js";

/** `"mention"` answers only messages that address the bot; `"always"` answers every message. */
export type GroupActivationMode = "mention" | "always";

/** Options for {@link groupActivationHook}. */
export interface GroupActivationOptions {
  /** Mode for chats `modeFor` has no answer for. */
  readonly mode: GroupActivationMode;
  /** Read on every message, so an app can change a chat's mode at run time. */
  modeFor?(channelId: string): GroupActivationMode | undefined;
  /** Hook name. Default `"group-activation"`. */
  readonly name?: string;
}

/**
 * A `pre_inbound` hook that blocks a group or thread message when the mode is `"mention"` and the
 * adapter reported `addressed: false`. Direct messages and events with `addressed` unset pass.
 */
export function groupActivationHook(options: GroupActivationOptions): GatewayHook {
  return {
    name: options.name ?? "group-activation",
    pre_inbound({ event }) {
      if (event.channel.type === "dm" || event.addressed !== false) return undefined;
      const mode = options.modeFor?.(event.channel.id) ?? options.mode;
      return mode === "mention" ? { block: true } : undefined;
    },
  };
}
