import type { BasePlatformAdapter, GatewayHandler, MessageEvent } from "@theokit/gateway";

import type { TurnOutcome } from "./agent-handler.js";
import { deliverText } from "./deliver-text.js";

/**
 * One channel of a broadcast group.
 *
 * @public
 */
export interface BroadcastMember {
  readonly adapter: BasePlatformAdapter;
  readonly channelId: string;
  /** Default `"dm"`. */
  readonly channelType?: "dm" | "group";
}

/**
 * Channels that answer as one conversation, and how much of it is remembered.
 *
 * @public
 */
export interface BroadcastGroupConfig {
  readonly id: string;
  readonly members: ReadonlyArray<BroadcastMember>;
  /** Most turns kept in the shared transcript. Default 10. */
  readonly maxTurns?: number;
  /** Most characters of transcript put in a prompt. Default 4000. */
  readonly maxChars?: number;
}

/**
 * The pieces to plug into `createAgentHandler`: `prompt` and `onTurnEnd` go in its options,
 * and `wrap` goes around the handler it returns.
 *
 * @public
 */
export interface BroadcastGroups {
  /** Runs turns of one group one after the other. Events outside every group pass straight through. */
  wrap(handler: GatewayHandler): GatewayHandler;
  /** The prompt with the group's shared transcript in front; `event.text` outside a group. */
  prompt(event: MessageEvent): string;
  /** Records a successful turn and sends its answer to every other member. Never throws. */
  onTurnEnd(event: MessageEvent, outcome: TurnOutcome): Promise<void>;
}

interface GroupState {
  readonly config: BroadcastGroupConfig;
  readonly maxTurns: number;
  readonly maxChars: number;
  entries: string[];
  tail: Promise<unknown>;
}

const DEFAULT_MAX_TURNS = 10;
const DEFAULT_MAX_CHARS = 4000;

function positive(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function keyOf(platform: string, channelId: string): string {
  return `${platform}\u0000${channelId}`;
}

function indexGroups(configs: ReadonlyArray<BroadcastGroupConfig>): Map<string, GroupState> {
  const byChannel = new Map<string, GroupState>();
  for (const config of configs) {
    const group: GroupState = {
      config,
      maxTurns: positive(config.maxTurns, DEFAULT_MAX_TURNS, "maxTurns"),
      maxChars: positive(config.maxChars, DEFAULT_MAX_CHARS, "maxChars"),
      entries: [],
      tail: Promise.resolve(),
    };
    for (const member of config.members) {
      const key = keyOf(member.adapter.platform, member.channelId);
      if (byChannel.has(key)) {
        throw new Error(`channel ${member.channelId} is in more than one broadcast group`);
      }
      byChannel.set(key, group);
    }
  }
  return byChannel;
}

/** Drops the oldest turns while over a bound; a single turn too long keeps its newest characters. */
function remember(group: GroupState, entry: string): void {
  const entries = [...group.entries, entry].slice(-group.maxTurns);
  let size = entries.join("\n").length;
  while (entries.length > 1 && size > group.maxChars) {
    const dropped = entries.shift() as string;
    size -= dropped.length + 1;
  }
  const [only] = entries;
  if (entries.length === 1 && only !== undefined && only.length > group.maxChars) {
    entries[0] = only.slice(-group.maxChars);
  }
  group.entries = entries;
}

/**
 * Makes several channels one conversation: every turn sees the same bounded transcript, turns of
 * a group run one at a time, and the answer is also sent to the group's other channels.
 *
 * Compose with `createAgentHandler({ ...options, prompt: groups.prompt, onTurnEnd: groups.onTurnEnd })`
 * and register `groups.wrap(handler)`. The transcript lives in memory. A channel belongs to at
 * most one group. Failed turns are not recorded or forwarded; a failed delivery to one member
 * does not stop the others.
 *
 * @public
 */
export function createBroadcastGroups(
  configs: ReadonlyArray<BroadcastGroupConfig>,
): BroadcastGroups {
  const byChannel = indexGroups(configs);
  const groupOf = (event: MessageEvent): GroupState | undefined =>
    byChannel.get(keyOf(event.platform, event.channel.id));
  return {
    wrap(handler) {
      return (event, ctx) => {
        const group = groupOf(event);
        if (group === undefined) return handler(event, ctx);
        const run = group.tail.then(() => handler(event, ctx));
        group.tail = run.catch(() => undefined);
        return run;
      };
    },
    prompt(event) {
      const group = groupOf(event);
      if (group === undefined || group.entries.length === 0) return event.text;
      return `Conversation so far:\n${group.entries.join("\n")}\n\nNew message:\n${event.text}`;
    },
    async onTurnEnd(event, outcome) {
      const group = groupOf(event);
      if (group === undefined || outcome.failed) return;
      remember(group, `User: ${event.text}\nAssistant: ${outcome.text}`);
      const self = keyOf(event.platform, event.channel.id);
      const others = group.config.members.filter(
        (member) => keyOf(member.adapter.platform, member.channelId) !== self,
      );
      await Promise.all(
        others.map((member) =>
          deliverText(member.adapter, member.channelId, outcome.text, member.channelType ?? "dm"),
        ),
      );
    },
  };
}
