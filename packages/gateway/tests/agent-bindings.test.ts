import { describe, expect, it } from "vitest";

import { GatewayConfigurationError } from "../src/errors/config-error.js";
import { bindingStrategy, createAgentBindings } from "../src/session/bindings.js";
import { defaultStrategy } from "../src/session/router.js";
import type { MessageEvent } from "../src/types/message-event.js";

function slack(senderId: string, type: "dm" | "group" = "dm", channelId = "C1"): MessageEvent {
  return {
    id: "x",
    platform: "slack",
    sender: { id: senderId },
    channel: { id: channelId, type },
    text: "",
    receivedAt: 0,
  } as unknown as MessageEvent;
}

const telegram = {
  id: "x",
  platform: "telegram",
  sender: { id: "U1" },
  channel: { id: "1", type: "dm" },
  text: "",
  receivedAt: 0,
} as unknown as MessageEvent;

describe("agent bindings", () => {
  const agents = ["a", "b", "d"];

  it("picks by platform and peer, else default", () => {
    const b = createAgentBindings({
      defaultAgent: "d",
      agents,
      rules: [
        { agent: "a", platform: "slack" },
        { agent: "b", platform: "slack", peer: "U1" },
      ],
    });
    expect(b.agentFor(slack("U1"))).toBe("b");
    expect(b.agentFor(slack("U2"))).toBe("a");
    expect(b.agentFor(telegram)).toBe("d");
  });

  it("uses channel id as peer outside a DM", () => {
    const b = createAgentBindings({
      defaultAgent: "d",
      agents,
      rules: [{ agent: "b", peer: "C9" }],
    });
    expect(b.agentFor(slack("U1", "group", "C9"))).toBe("b");
    expect(b.agentFor(slack("C9", "group", "C1"))).toBe("d");
  });

  it("ties go to the earlier rule", () => {
    const b = createAgentBindings({
      defaultAgent: "d",
      agents,
      rules: [
        { agent: "b", platform: "slack" },
        { agent: "a", platform: "slack" },
      ],
    });
    expect(b.agentFor(slack("U1"))).toBe("b");
  });

  it("account beats platform, peer beats account", () => {
    const rules = [
      { agent: "a", platform: "slack" as const },
      { agent: "b", account: "acc" },
      { agent: "d", peer: "U1" },
    ];
    const accountOf = () => "acc";
    const b = createAgentBindings({ defaultAgent: "a", agents, rules, accountOf });
    expect(b.agentFor(slack("U1"))).toBe("d");
    expect(b.agentFor(slack("U2"))).toBe("b");
    const c = createAgentBindings({ defaultAgent: "a", agents, rules: rules.slice(0, 2) });
    expect(c.agentFor(slack("U2"))).toBe("a");
  });

  it("rejects unknown and empty rules", () => {
    try {
      createAgentBindings({
        defaultAgent: "d",
        agents,
        rules: [{ agent: "ghost", platform: "slack" }],
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayConfigurationError);
      expect((e as GatewayConfigurationError).code).toBe("unknown_agent");
      expect((e as Error).message).toContain("ghost");
    }
    expect(() => createAgentBindings({ defaultAgent: "ghost", agents, rules: [] })).toThrow(
      /ghost/,
    );
    try {
      createAgentBindings({ defaultAgent: "d", agents, rules: [{ agent: "a" }] });
      expect.unreachable();
    } catch (e) {
      expect((e as GatewayConfigurationError).code).toBe("empty_binding_rule");
    }
  });

  it("bindingStrategy keeps agents a-b and a_b apart", () => {
    const names = ["a-b", "a_b"];
    const key = (agent: string) =>
      bindingStrategy(
        createAgentBindings({ defaultAgent: agent, agents: names, rules: [] }),
        defaultStrategy,
      )(slack("U1"));
    expect(key("a-b")).not.toBe(key("a_b"));
  });
});
