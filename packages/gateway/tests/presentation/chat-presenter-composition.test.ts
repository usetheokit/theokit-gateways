import { readFile } from "node:fs/promises";
import { type AgentOutputEvent, ChatPresenter } from "@theokit/presenter";
import { describe, expect, it } from "vitest";

import type { OutboundMessage } from "../../src/adapter/base.js";
import { channelRendering } from "../../src/index.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

/**
 * B-019 FR-003, NFR-002: the released `ChatPresenter`, built from `channelRendering`, in front of
 * an adapter.
 *
 * The defect this item was filed for reached a real phone as `"TheOi! 👋"`: a hand-written loop
 * concatenated every frame carrying text, and `"The"` was the start of the model's reasoning. The
 * same turn is driven here through the presenter and through that loop, into the last point
 * observable offline (`MockAdapter.sendMessage`), and one check decides both. The loop failing the
 * check is what shows the check can fail.
 */

const REASONING = "The user greeted me, so I should greet them back.";
/** Distinctive enough that an ordinary answer never contains it, short enough to catch a fragment. */
const REASONING_PREFIX = REASONING.slice(0, "The user greeted".length);

const channel = { id: "5511999999999", type: "dm" } as const;

/** One agent turn: reasoning, a tool round trip, the answer, the end. */
const TURN: readonly AgentOutputEvent[] = [
  { type: "reasoning", text: REASONING },
  { type: "tool-call", callId: "call-1", name: "lookup_user", input: { id: "5511999999999" } },
  { type: "tool-result", callId: "call-1", name: "lookup_user", result: { name: "Ana" } },
  { type: "text", text: "**Oi!**" },
  { type: "text", text: " 👋" },
  { type: "finish", reason: "stop" },
];

/** Every message sent carries none of the model's reasoning. Throws naming the one that did. */
function assertNoReasoning(sent: readonly OutboundMessage[]): void {
  for (const message of sent) {
    if (message.text.includes(REASONING_PREFIX)) {
      throw new Error(`reasoning reached the channel: ${JSON.stringify(message.text)}`);
    }
  }
}

async function sendThroughPresenter(
  adapter: MockAdapter,
  events: readonly AgentOutputEvent[],
): Promise<void> {
  const presenter = new ChatPresenter({ channel, ...channelRendering(adapter.platform) });
  for (const event of events) {
    for (const message of presenter.present(event)) {
      await adapter.sendMessage(message);
    }
  }
}

/** The shape that produced `"TheOi!"`: every event carrying `text`, concatenated and sent. */
async function sendThroughNaiveLoop(
  adapter: MockAdapter,
  events: readonly AgentOutputEvent[],
): Promise<void> {
  let text = "";
  for (const event of events) if ("text" in event) text += event.text;
  await adapter.sendMessage({ channel, text });
}

describe("ChatPresenter composed with channelRendering", () => {
  it("never sends the model's reasoning to the channel", async () => {
    const adapter = new MockAdapter("whatsapp");

    await sendThroughPresenter(adapter, TURN);

    expect(adapter.sent).toEqual([{ channel, text: "*Oi!* 👋", format: "plain" }]);
    expect(() => assertNoReasoning(adapter.sent)).not.toThrow();
  });

  it("a loop that concatenates every delta fails the same check", async () => {
    const adapter = new MockAdapter("whatsapp");

    await sendThroughNaiveLoop(adapter, TURN);

    expect(adapter.sent).toHaveLength(1);
    expect(() => assertNoReasoning(adapter.sent)).toThrow(/reasoning reached the channel/);
  });

  it("keeps @theokit/presenter out of the runtime and peer dependencies", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;

    expect(Object.keys(manifest.dependencies ?? {})).not.toContain("@theokit/presenter");
    expect(Object.keys(manifest.peerDependencies ?? {})).not.toContain("@theokit/presenter");
    expect(Object.keys(manifest.devDependencies ?? {})).toContain("@theokit/presenter");
  });

  it("sends nothing for a turn with no text", async () => {
    const adapter = new MockAdapter("whatsapp");

    await sendThroughPresenter(adapter, [
      { type: "reasoning", text: REASONING },
      { type: "finish", reason: "stop" },
    ]);

    expect(adapter.sent).toEqual([]);
    expect(adapter.sendAttempts).toBe(0);
  });
});
