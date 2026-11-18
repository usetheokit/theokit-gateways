/**
 * `@theokit/gateway@0.21.0` has no `channelConfigReaders` export; importing the channel against a
 * core that lacks it must still work (#564).
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@theokit/gateway", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { channelConfigReaders: _omitted, ...rest } = actual;
  return rest;
});

describe("gateway-line against a core without channelConfigReaders", () => {
  it("imports and validates config", async () => {
    const { lineChannel } = await import("../src/channel.js");
    expect(lineChannel).toBeDefined();
    expect(() => lineChannel.create({ channelSecret: 1, channelAccessToken: "t" })).toThrow(
      /config\.channelSecret must be a string/,
    );
    expect(() =>
      lineChannel.create({ channelSecret: "s", channelAccessToken: "t", requireMention: "yes" }),
    ).toThrow(/config\.requireMention must be a boolean/);
  });
});
