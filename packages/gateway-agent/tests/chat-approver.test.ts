import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createChatApprover } from "../src/index.js";

function ev(text: string, sender = "U1", channel = "C1"): MessageEvent {
  return {
    id: `${sender}-${text}`,
    platform: "slack",
    sender: { id: sender },
    channel: { id: channel, type: "group" },
    text,
    receivedAt: 0,
  } as MessageEvent;
}

function setup(
  over: { send?: (e: MessageEvent, t: string) => Promise<void>; timeoutMs?: number } = {},
) {
  const sent: string[] = [];
  const approver = createChatApprover({
    conversationOf: (e) => e.channel.id,
    isOwner: (e) => e.sender.id === "U1",
    send: over.send ?? (async (_e, t) => void sent.push(t)),
    timeoutMs: over.timeoutMs,
  });
  const say = async (e: MessageEvent) => approver.hook.pre_inbound?.({ event: e });
  return { approver, say, sent };
}

afterEach(() => vi.useRealTimers());

describe("createChatApprover", () => {
  it("resolves once, always and deny from an owner", async () => {
    const { approver, say, sent } = setup();
    await say(ev("hello"));
    const p = approver.ask("C1", "rm -rf x");
    expect(sent[0]).toContain("rm -rf x");
    expect(approver.hasPending(ev("x"))).toBe(true);
    expect(await say(ev("/approve"))).toEqual({ block: true, message: "Approved." });
    expect(await p).toEqual({ answer: "once", by: "slack:U1" });

    const p2 = approver.ask("C1", "q");
    await say(ev("<@B1> /approve@bot always"));
    expect((await p2).answer).toBe("always");

    const p3 = approver.ask("C1", "q");
    expect(await say(ev("/deny"))).toEqual({ block: true, message: "Denied." });
    expect((await p3).answer).toBe("deny");
    expect(approver.hasPending(ev("x"))).toBe(false);
  });

  it("keeps the question pending for a non-owner", async () => {
    const { approver, say } = setup();
    await say(ev("hi"));
    let settled = false;
    const p = approver.ask("C1", "q").then((r) => {
      settled = true;
      return r;
    });
    expect(await say(ev("/approve", "U2"))).toEqual({
      block: true,
      message: "Only an owner can do that.",
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await say(ev("/deny"));
    await p;
  });

  it("denies after the timeout and clears the timer", async () => {
    vi.useFakeTimers();
    const { approver, say } = setup({ timeoutMs: 5000 });
    await say(ev("hi"));
    const p = approver.ask("C1", "q");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ answer: "deny" });
    expect(vi.getTimerCount()).toBe(0);
    expect(approver.hasPending(ev("x"))).toBe(false);
  });

  it("denies when send throws", async () => {
    const { approver, say } = setup({
      send: async () => {
        throw new Error("down");
      },
    });
    await say(ev("hi"));
    expect(await approver.ask("C1", "q")).toEqual({ answer: "deny" });
    expect(approver.hasPending(ev("x"))).toBe(false);
  });

  it("denies a second question without sending, and an unknown conversation", async () => {
    const { approver, say, sent } = setup();
    expect(await approver.ask("C1", "q")).toEqual({ answer: "deny" });
    await say(ev("hi"));
    const first = approver.ask("C1", "one");
    expect(await approver.ask("C1", "two")).toEqual({ answer: "deny" });
    expect(sent).toHaveLength(1);
    await say(ev("/approve"));
    expect((await first).answer).toBe("once");
  });

  it("blocks /approve with nothing pending and ignores other text", async () => {
    const { say } = setup();
    expect(await say(ev("/approve"))).toEqual({
      block: true,
      message: "Nothing is waiting for approval.",
    });
    expect(await say(ev("/approve maybe"))).toBeUndefined();
    expect(await say(ev("hello"))).toBeUndefined();
  });
});
