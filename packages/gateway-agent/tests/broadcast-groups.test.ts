import {
  BasePlatformAdapter,
  type MessageEvent,
  type OutboundMessage,
  type SendResult,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { createBroadcastGroups, type TurnOutcome } from "../src/index.js";

class Fake extends BasePlatformAdapter {
  readonly platform: "telegram" | "slack";
  sent: OutboundMessage[] = [];
  fail = false;
  constructor(platform: "telegram" | "slack") {
    super();
    this.platform = platform;
  }
  override async connect(): Promise<boolean> {
    return true;
  }
  override async disconnect(): Promise<void> {}
  override async sendMessage(out: OutboundMessage): Promise<SendResult> {
    this.sent.push(out);
    if (this.fail) return { ok: false, error: { code: "blocked", message: "no" } };
    return { ok: true, messageId: "m" };
  }
  override onInbound(): () => void {
    return () => {};
  }
  override async deliver(): Promise<"ok" | "no_handler" | "handler_threw"> {
    return "ok";
  }
}

const ev = (platform: string, id: string, text: string) =>
  ({
    id: "e",
    platform,
    sender: { id: "1" },
    channel: { id, type: "dm" },
    text,
    receivedAt: 0,
  }) as unknown as MessageEvent;
const ok = (text: string): TurnOutcome => ({ text, failed: false });

function setup(extra = {}) {
  const tg = new Fake("telegram");
  const sl = new Fake("slack");
  const groups = createBroadcastGroups([
    {
      id: "g",
      members: [
        { adapter: tg, channelId: "A" },
        { adapter: sl, channelId: "B" },
      ],
      ...extra,
    },
  ]);
  return { tg, sl, groups };
}

describe("createBroadcastGroups", () => {
  it("sends the answer to the other member only", async () => {
    const { tg, sl, groups } = setup();
    await groups.onTurnEnd(ev("telegram", "A", "q"), ok("answer"));
    expect(sl.sent.map((m) => m.text)).toEqual(["answer"]);
    expect(tg.sent).toHaveLength(0);
  });

  it("keeps delivering when one member refuses, and skips failed turns", async () => {
    const tg = new Fake("telegram");
    const sl = new Fake("slack");
    const x = new Fake("slack");
    sl.fail = true;
    const groups = createBroadcastGroups([
      {
        id: "g",
        members: [
          { adapter: tg, channelId: "A" },
          { adapter: sl, channelId: "B" },
          { adapter: x, channelId: "C" },
        ],
      },
    ]);
    await groups.onTurnEnd(ev("telegram", "A", "q"), { text: "bad", failed: true });
    expect(x.sent).toHaveLength(0);
    await groups.onTurnEnd(ev("telegram", "A", "q"), ok("yes"));
    expect(x.sent).toHaveLength(1);
    expect(groups.prompt(ev("telegram", "A", "n"))).not.toContain("bad");
  });

  it("runs two messages of one group one after the other", async () => {
    const { groups } = setup();
    const log: string[] = [];
    const wrapped = groups.wrap(async (e) => {
      log.push(`start ${e.text}`);
      await new Promise((r) => setTimeout(r, 10));
      log.push(`end ${e.text}`);
    });
    const ctx = {} as never;
    await Promise.all([
      wrapped(ev("telegram", "A", "1"), ctx),
      wrapped(ev("slack", "B", "2"), ctx),
    ]);
    expect(log).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("continues the queue after a failing turn", async () => {
    const { groups } = setup();
    const wrapped = groups.wrap(async (e) => {
      if (e.text === "1") throw new Error("x");
    });
    const first = wrapped(ev("telegram", "A", "1"), {} as never);
    const second = wrapped(ev("telegram", "A", "2"), {} as never);
    await expect(first).rejects.toThrow();
    await expect(second).resolves.toBeUndefined();
  });

  it("shares the transcript across channels within the turn bound", async () => {
    const { groups } = setup({ maxTurns: 2 });
    for (const t of ["one", "two", "three"])
      await groups.onTurnEnd(ev("telegram", "A", t), ok(`r-${t}`));
    const prompt = groups.prompt(ev("slack", "B", "next"));
    expect(prompt).not.toContain("one");
    expect(prompt).toContain("r-two");
    expect(prompt).toContain("r-three");
    expect(prompt.endsWith("New message:\nnext")).toBe(true);
  });

  it("keeps the transcript within the character bound", async () => {
    const { groups } = setup({ maxChars: 60 });
    await groups.onTurnEnd(ev("telegram", "A", "a"), ok("x".repeat(30)));
    await groups.onTurnEnd(ev("telegram", "A", "b"), ok("y".repeat(30)));
    await groups.onTurnEnd(ev("telegram", "A", "c"), ok("z".repeat(500)));
    const prompt = groups.prompt(ev("telegram", "A", "n"));
    const transcript = prompt.slice(prompt.indexOf("\n") + 1, prompt.indexOf("\n\nNew message"));
    expect(transcript.length).toBeLessThanOrEqual(60);
    expect(transcript).toContain("zzz");
  });

  it("passes other channels through and rejects bad config", () => {
    const { groups } = setup();
    expect(groups.prompt(ev("telegram", "Z", "hi"))).toBe("hi");
    const a = new Fake("telegram");
    expect(() =>
      createBroadcastGroups([
        { id: "1", members: [{ adapter: a, channelId: "A" }] },
        { id: "2", members: [{ adapter: a, channelId: "A" }] },
      ]),
    ).toThrow();
    expect(() => createBroadcastGroups([{ id: "1", members: [], maxTurns: 0 }])).toThrow();
  });
});
