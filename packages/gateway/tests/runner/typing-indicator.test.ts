/** The runner shows a typing indicator while a handler runs, renews it, and stops it after. */

import { afterEach, describe, expect, it, vi } from "vitest";

import { GatewayRunner } from "../../src/runner/gateway-runner.js";
import type { MessageEvent } from "../../src/types/message-event.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

function tg(): MessageEvent {
  return {
    id: "tg-1",
    platform: "telegram",
    sender: { id: "100" },
    channel: { id: "1", type: "dm" },
    text: "hi",
    receivedAt: 0,
    telegram: { chatId: 1, messageId: 1, raw: {} },
  };
}

class TypingAdapter extends MockAdapter {
  readonly calls: string[] = [];
  override async startTyping(id: string): Promise<void> {
    this.calls.push(`start:${id}`);
  }
  override async stopTyping(id: string): Promise<void> {
    this.calls.push(`stop:${id}`);
  }
}

describe("typing indicator", () => {
  afterEach(() => vi.useRealTimers());

  it("starts before the handler, renews while it runs, stops after", async () => {
    vi.useFakeTimers();
    const adapter = new TypingAdapter("telegram");
    const runner = new GatewayRunner({
      adapters: [adapter],
      handler: async () => {
        await new Promise((r) => setTimeout(r, 9_000));
      },
    });
    await runner.start();
    const done = adapter.emit(tg());
    await vi.advanceTimersByTimeAsync(9_000);
    await done;
    await runner.stop();
    expect(adapter.calls).toEqual(["start:1", "start:1", "start:1", "stop:1"]);
  });

  it("a failing indicator does not fail the turn", async () => {
    const adapter = new TypingAdapter("telegram");
    adapter.startTyping = async () => {
      throw new Error("boom");
    };
    const seen: string[] = [];
    const runner = new GatewayRunner({
      adapters: [adapter],
      handler: async () => {
        seen.push("ran");
      },
    });
    await runner.start();
    await adapter.emit(tg());
    await runner.stop();
    expect(seen).toEqual(["ran"]);
  });
});
