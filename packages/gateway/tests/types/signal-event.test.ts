/**
 * `signal` is a first-party platform (B-354, plan ADR D1).
 *
 * These assertions run under `tsc`, which the package's `test` script runs before vitest: an
 * assignment that does not type-check fails the suite even though vitest itself strips types.
 */

import { describe, expect, it } from "vitest";

import type { MessageEvent, PlatformName, SignalMessageEvent } from "../../src/index.js";

function makeSignalEvent(): MessageEvent {
  return {
    id: "sg-1",
    platform: "signal",
    sender: { id: "+5511999999999" },
    channel: { id: "group.abc", type: "group" },
    text: "oi",
    receivedAt: 0,
    signal: { timestamp: 1_700_000_000_000, groupId: "abc", raw: {} },
  };
}

describe("SignalMessageEvent", () => {
  it("names signal as a platform", () => {
    const name: PlatformName = "signal";

    expect(name).toBe("signal");
  });

  it("narrows to the signal variant on its discriminator", () => {
    const event = makeSignalEvent();
    if (event.platform !== "signal") throw new Error("unreachable");
    const narrowed: SignalMessageEvent = event;
    const timestamp: number = narrowed.signal.timestamp;

    expect(timestamp).toBe(1_700_000_000_000);
    expect(narrowed.signal.groupId).toBe("abc");
  });
});
