import { describe, expect, it } from "vitest";

import { runAgentText, type TurnAgent } from "../src/index.js";

type Frame = { readonly type: string; readonly [key: string]: unknown };

function fakeAgent(
  frames: readonly Frame[],
  outcome: { status: string; error?: { code?: string } },
): { agent: TurnAgent; sent: Array<Record<string, unknown> | undefined> } {
  const sent: Array<Record<string, unknown> | undefined> = [];
  const agent: TurnAgent = {
    async send(_prompt, options) {
      sent.push(options);
      return {
        async *stream() {
          for (const frame of frames) yield frame;
        },
        wait: async () => outcome,
      };
    },
  };
  return { agent, sent };
}

const TEXT_A = { type: "assistant", message: { content: [{ type: "text", text: "Hello " }] } };
const TEXT_B = { type: "assistant", message: { content: [{ type: "text", text: "world" }] } };

describe("runAgentText", () => {
  it("collects both text frames when the run finished", async () => {
    const { agent } = fakeAgent([TEXT_A, TEXT_B], { status: "finished" });
    const result = await runAgentText(agent, "hi");
    expect(result.ok).toBe(true);
    expect(result.text).toContain("Hello");
    expect(result.text).toContain("world");
  });

  it("fails with the stream's code even when wait() says finished", async () => {
    const { agent } = fakeAgent([TEXT_A, { type: "status", status: "ERROR", message: "x" }], {
      status: "finished",
    });
    const result = await runAgentText(agent, "hi");
    expect(result).toMatchObject({ ok: false, failure: "AGENT_ERROR" });
  });

  it("fails with the SDK code and sends the untrusted-content guard", async () => {
    const { agent, sent } = fakeAgent([], {
      status: "error",
      error: { code: "rate_limited" },
    });
    const result = await runAgentText(agent, "hi", {
      sendOptions: { toolResultGuard: { delimit: false }, other: 1 },
    });
    expect(result).toMatchObject({ ok: false, failure: "rate_limited" });
    expect(sent[0]).toMatchObject({ toolResultGuard: { delimit: true }, other: 1 });
  });

  it("reports 'no error code' when none is given", async () => {
    const { agent } = fakeAgent([], { status: "error" });
    expect(await runAgentText(agent, "hi")).toMatchObject({
      ok: false,
      failure: "no error code",
    });
  });
});
