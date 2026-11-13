/**
 * Rule-based agent bindings: pick the agent that answers a message by
 * platform, account and peer.
 *
 * @public
 */

import { GatewayConfigurationError } from "../errors/config-error.js";
import type { MessageEvent, PlatformName } from "../types/message-event.js";
import { type AgentIdStrategy, sanitize } from "./router.js";

export interface AgentBindingRule {
  readonly agent: string;
  readonly platform?: PlatformName;
  /** Matched against accountOf(event). */
  readonly account?: string;
  /** Matched against event.sender.id for a DM and event.channel.id otherwise. */
  readonly peer?: string;
}

/** Options for {@link createAgentBindings}. */
export interface AgentBindingsOptions {
  readonly defaultAgent: string;
  readonly rules: ReadonlyArray<AgentBindingRule>;
  /** Agents that exist; every rule and the default must name one. */
  readonly agents: ReadonlyArray<string>;
  /** Which bot account received the event, when the app runs several. Default: undefined. */
  readonly accountOf?: (event: MessageEvent) => string | undefined;
}

/** Chooses the agent that answers an event. */
export interface AgentBindings {
  agentFor(event: MessageEvent): string;
}

function unknownAgent(agent: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway", {
    code: "unknown_agent",
    message: `gateway: unknown_agent: ${agent}`,
    detail: agent,
  });
}

/**
 * Builds bindings from rules. The most specific matching rule wins (peer 4, account 2,
 * platform 1), ties go to the earlier rule, no match gives `defaultAgent`.
 * Throws `GatewayConfigurationError` for `unknown_agent` or `empty_binding_rule`.
 */
export function createAgentBindings(options: AgentBindingsOptions): AgentBindings {
  const known = new Set(options.agents);
  if (!known.has(options.defaultAgent)) throw unknownAgent(options.defaultAgent);
  for (const rule of options.rules) {
    if (!known.has(rule.agent)) throw unknownAgent(rule.agent);
    if (rule.platform === undefined && rule.account === undefined && rule.peer === undefined) {
      throw new GatewayConfigurationError("gateway", {
        code: "empty_binding_rule",
        message: `gateway: empty_binding_rule: ${rule.agent}`,
        detail: rule.agent,
      });
    }
  }
  const rules = [...options.rules];
  const { accountOf } = options;

  return {
    agentFor(event) {
      const ctx = {
        platform: event.platform as string,
        account: accountOf?.(event),
        peer: event.channel.type === "dm" ? event.sender.id : event.channel.id,
      };
      let best = options.defaultAgent;
      let bestScore = 0;
      for (const rule of rules) {
        const score = scoreRule(rule, ctx);
        if (score > bestScore) {
          best = rule.agent;
          bestScore = score;
        }
      }
      return best;
    },
  };
}

interface MatchContext {
  readonly platform: string;
  readonly account: string | undefined;
  readonly peer: string;
}

/** 0 when the rule does not match; otherwise peer 4 + account 2 + platform 1 for the fields it sets. */
function scoreRule(rule: AgentBindingRule, ctx: MatchContext): number {
  const fields: ReadonlyArray<readonly [string | undefined, string | undefined, number]> = [
    [rule.platform, ctx.platform, 1],
    [rule.account, ctx.account, 2],
    [rule.peer, ctx.peer, 4],
  ];
  let score = 0;
  for (const [want, got, weight] of fields) {
    if (want === undefined) continue;
    if (want !== got) return 0;
    score += weight;
  }
  return score;
}

/** Prefixes another strategy's key with the bound agent, so two agents never share a session. */
export function bindingStrategy(bindings: AgentBindings, inner: AgentIdStrategy): AgentIdStrategy {
  return (event) => `${sanitize(bindings.agentFor(event))}-${inner(event)}`;
}
