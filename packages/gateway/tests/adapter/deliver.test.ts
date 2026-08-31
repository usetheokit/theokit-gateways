/**
 * `deliver` — the out-of-band ingest, and the reason it had to exist.
 *
 * `onInbound` is the seam every adapter implements, and until this landed it had no public
 * counterpart: an application that received a webhook had no supported call to hand the payload to
 * the adapter. Six platforms self-deliver once connected, so the asymmetry stayed invisible —
 * `GatewayRunner` worked for eight and silently did nothing for LINE and WhatsApp Cloud, which
 * every app then wired by hand beside the runner instead of through it (#83).
 *
 * What is asserted here is the CONTRACT, on the base class, once: the three outcomes a caller can
 * act on, and that a handler's throw is contained and named as the handler's.
 */

import { describe, expect, it, vi } from "vitest";
import type { MessageEvent } from "../../src/types/message-event.js";
import { MockAdapter } from "./mock-adapter.js";

const event = (text = "hi"): MessageEvent =>
  ({
    id: "evt-1",
    platform: "telegram",
    sender: { id: "u1" },
    channel: { id: "c1", type: "dm" },
    text,
    receivedAt: 1_700_000_000_000,
  }) as MessageEvent;

describe("BasePlatformAdapter.deliver", () => {
  it("reaches the handler onInbound subscribed", async () => {
    const adapter = new MockAdapter("telegram");
    const seen: string[] = [];
    adapter.onInbound(async (e) => {
      seen.push(e.text);
    });

    expect(await adapter.deliver(event("from a webhook"))).toBe("ok");
    expect(seen).toEqual(["from a webhook"]);
  });

  it("says no_handler rather than pretending, when nobody subscribed", async () => {
    // The distinction a webhook route acts on: answering 200 for a message nothing received tells
    // the provider to stop retrying it.
    const adapter = new MockAdapter("telegram");

    expect(await adapter.deliver(event())).toBe("no_handler");
  });

  it("reports a thrown handler as the HANDLER's failure, and keeps the adapter usable", async () => {
    // A handler is user code. Its throw is contained, named as the handler's rather than the
    // platform's — two adapters once reported it as a platform-client error, which sent whoever
    // debugged their own handler to the wrong repository (#41) — and delivery continues.
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const adapter = new MockAdapter("telegram");
    let calls = 0;
    adapter.onInbound(async () => {
      calls += 1;
      if (calls === 1) throw new Error("consumer bug");
    });

    try {
      expect(await adapter.deliver(event())).toBe("handler_threw");
      expect(stderr.mock.calls.map(String).join("")).toContain("[telegram] handler threw");
      // The second message still arrives: one bad handler does not end the stream.
      expect(await adapter.deliver(event())).toBe("ok");
      expect(calls).toBe(2);
    } finally {
      stderr.mockRestore();
    }
  });

  it("stops reaching a handler that unsubscribed", async () => {
    const adapter = new MockAdapter("telegram");
    const off = adapter.onInbound(async () => undefined);
    off();

    expect(await adapter.deliver(event())).toBe("no_handler");
  });

  it("reaches only the LAST handler, because onInbound replaces rather than stacks", async () => {
    // EC-H. The contract was previously untestable from outside an adapter, which is exactly why
    // three of them had grown an `@internal` dispatch method to test it with.
    const adapter = new MockAdapter("telegram");
    const seen: string[] = [];
    adapter.onInbound(async () => {
      seen.push("first");
    });
    adapter.onInbound(async () => {
      seen.push("second");
    });

    await adapter.deliver(event());

    expect(seen).toEqual(["second"]);
  });
});
