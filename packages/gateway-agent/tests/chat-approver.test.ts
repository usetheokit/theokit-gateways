import type { MessageEvent } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatApprover } from "../src/index.js";

function ev(text: string, sender = "U1", channel = "C1"): MessageEvent {
  return {
    id: `m-${Math.random()}`,
    platform: "slack",
    sender: { id: sender },
    channel: { id: channel, type: "group" },
    text,
    receivedAt: 0,
  } as unknown as MessageEvent;
}

function setup(
  over: { send?: (e: MessageEvent, t: string) => Promise<void>; timeoutMs?: number } = {},
) {
  const send = vi.fn(over.send ?? (async () => {}));
  const approver = createChatApprover({
    conversationOf: (e) => e.channel.id,
    isOwner: (e) => e.sender.id === "U1",
    send,
    timeoutMs: over.timeoutMs,
  });
  const say = async (e: MessageEvent) => approver.hook.pre_inbound?.({ event: e } as never);
  return { approver, send, say };
}

afterEach(() => vi.useRealTimers());

describe("createChatApprover", () => {
  it("owner /approve resolves once with by", async () => {
    const { approver, say, send } = setup();
    await say(ev("hi"));
    const p = approver.ask("C1", "rm -rf x");
    expect(send.mock.calls[0]?.[1]).toContain("rm -rf x");
    expect(approver.hasPending(ev("x"))).toBe(true);
    expect(await say(ev("/approve"))).toEqual({ block: true, message: "Approved." });
    expect(await p).toEqual({ answer: "once", by: "slack:U1" });
    expect(approver.hasPending(ev("x"))).toBe(false);
  });

  it("parses mentions, @bot suffix and always", async () => {
    const { approver, say } = setup();
    await say(ev("hi"));
    const p = approver.ask("C1", "q");
    await say(ev("<@B1> /approve@bot always"));
    expect((await p).answer).toBe("always");
  });

  it("/deny resolves deny", async () => {
    const { approver, say } = setup();
    await say(ev("hi"));
    const p = approver.ask("C1", "q");
    expect(await say(ev("/deny"))).toEqual({ block: true, message: "Denied." });
    expect(await p).toEqual({ answer: "deny", by: "slack:U1" });
  });

  it("non-owner leaves it pending", async () => {
    const { approver, say } = setup();
    await say(ev("hi"));
    const p = approver.ask("C1", "q");
    expect(await say(ev("/approve", "U2"))).toEqual({
      block: true,
      message: "Only an owner can do that.",
    });
    expect(approver.hasPending(ev("x"))).toBe(true);
    await say(ev("/deny"));
    await p;
  });

  it("denies on timeout", async () => {
    vi.useFakeTimers();
    const { approver, say } = setup({ timeoutMs: 1000 });
    await say(ev("hi"));
    const p = approver.ask("C1", "q");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ answer: "deny" });
    expect(approver.hasPending(ev("x"))).toBe(false);
  });

  it("denies when send throws", async () => {
    const { approver, say } = setup({
      send: async () => {
        throw new Error("boom");
      },
    });
    await say(ev("hi"));
    expect(await approver.ask("C1", "q")).toEqual({ answer: "deny" });
    expect(approver.hasPending(ev("x"))).toBe(false);
  });

  it("denies a second ask without sending, and an unseen conversation", async () => {
    const { approver, say, send } = setup();
    await say(ev("hi"));
    const p = approver.ask("C1", "q");
    expect(await approver.ask("C1", "q2")).toEqual({ answer: "deny" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await approver.ask("nope", "q")).toEqual({ answer: "deny" });
    await say(ev("/approve"));
    await p;
  });

  it("blocks /approve with nothing pending; other text passes", async () => {
    const { say } = setup();
    expect(await say(ev("/approve"))).toEqual({
      block: true,
      message: "Nothing is waiting for approval.",
    });
    expect(await say(ev("/approve maybe"))).toBeUndefined();
    expect(await say(ev("hello"))).toBeUndefined();
  });
});
