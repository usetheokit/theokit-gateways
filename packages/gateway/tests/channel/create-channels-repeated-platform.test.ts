/**
 * Regression test for B-035: `createChannels` built two adapters for one platform, and
 * `GatewayRunner` (keyed by platform) then sent the first adapter's replies through the second
 * and never disconnected the first.
 */

import { describe, expect, it, vi } from "vitest";

import type { ChannelDescriptor } from "../../src/channel/channel-descriptor.js";
import { createChannels } from "../../src/channel/create-channels.js";
import { GatewayConfigurationError } from "../../src/errors/config-error.js";
import type { PlatformName } from "../../src/types/message-event.js";
import { MockAdapter } from "../adapter/mock-adapter.js";

function descriptorFor(
  platform: PlatformName,
  create: () => MockAdapter,
): ChannelDescriptor<MockAdapter> {
  return {
    platform,
    transport: "socket",
    config: [{ key: "token", required: true, secret: true, description: "bot token" }],
    create,
  };
}

function telegramDescriptor(create: () => MockAdapter): ChannelDescriptor<MockAdapter> {
  return descriptorFor("telegram", create);
}

describe("createChannels with a repeated platform", () => {
  it("rejects_the_second_entry_for_a_platform_already_built", () => {
    const first = vi.fn(() => new MockAdapter("telegram"));
    const second = vi.fn(() => new MockAdapter("telegram"));
    const third = vi.fn(() => new MockAdapter("telegram"));

    const result = createChannels([
      { descriptor: telegramDescriptor(first), config: { token: "a" } },
      { descriptor: telegramDescriptor(second), config: { token: "b" } },
      { descriptor: telegramDescriptor(third), config: { token: "c" } },
    ]);

    expect(result.adapters, "two adapters of one platform were built").toHaveLength(1);
    expect(result.adapters[0]).toBe(first.mock.results[0]?.value);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(third).not.toHaveBeenCalled();
    expect(result.rejected).toHaveLength(2);
    for (const rejection of result.rejected) {
      expect(rejection.platform).toBe("telegram");
      expect(rejection.error).toBeInstanceOf(GatewayConfigurationError);
      expect(rejection.error.code).toBe("duplicate_channel");
      expect(rejection.error.message).toContain("telegram");
    }
  });

  it("keeps_other_platforms_and_builds_after_an_earlier_rejection", () => {
    const telegramMissingToken = vi.fn(() => new MockAdapter("telegram"));
    const discordFirst = vi.fn(() => new MockAdapter("discord"));
    const telegramValid = vi.fn(() => new MockAdapter("telegram"));
    const discordSecond = vi.fn(() => new MockAdapter("discord"));

    const result = createChannels([
      { descriptor: telegramDescriptor(telegramMissingToken), config: { token: "" } },
      { descriptor: descriptorFor("discord", discordFirst), config: { token: "d" } },
      { descriptor: telegramDescriptor(telegramValid), config: { token: "t" } },
      { descriptor: descriptorFor("discord", discordSecond), config: { token: "e" } },
    ]);

    expect(result.adapters.map((adapter) => adapter.platform)).toEqual(["discord", "telegram"]);
    expect(result.rejected.map((rejection) => [rejection.platform, rejection.error.code])).toEqual([
      ["telegram", "missing_required_config"],
      ["discord", "duplicate_channel"],
    ]);
    expect(telegramMissingToken).not.toHaveBeenCalled();
    expect(telegramValid).toHaveBeenCalledTimes(1);
    expect(discordSecond).not.toHaveBeenCalled();
    for (const adapter of result.adapters) {
      expect((adapter as MockAdapter).connectCount, "createChannels connected an adapter").toBe(0);
    }

    // EC-1: an entry whose `create` throws a configuration error built nothing, so the next
    // entry for the same platform is still built.
    const refused = new GatewayConfigurationError("gateway-telegram", { code: "invalid_token" });
    const throwingCreate = vi.fn((): MockAdapter => {
      throw refused;
    });
    const afterThrow = vi.fn(() => new MockAdapter("telegram"));

    const afterRefusal = createChannels([
      { descriptor: telegramDescriptor(throwingCreate), config: { token: "bad" } },
      { descriptor: telegramDescriptor(afterThrow), config: { token: "good" } },
    ]);

    expect(afterRefusal.adapters.map((adapter) => adapter.platform)).toEqual(["telegram"]);
    expect(afterThrow).toHaveBeenCalledTimes(1);
    expect(afterRefusal.rejected).toEqual([{ platform: "telegram", error: refused }]);

    // A repeated platform is reported as a duplicate even when its own config is incomplete:
    // the platform is already served, so the missing field is moot.
    const servedCreate = vi.fn(() => new MockAdapter("telegram"));
    const incompleteRepeat = vi.fn(() => new MockAdapter("telegram"));

    const repeatMissingConfig = createChannels([
      { descriptor: telegramDescriptor(servedCreate), config: { token: "a" } },
      { descriptor: telegramDescriptor(incompleteRepeat), config: { token: "" } },
    ]);

    expect(repeatMissingConfig.adapters).toHaveLength(1);
    expect(incompleteRepeat).not.toHaveBeenCalled();
    expect(repeatMissingConfig.rejected.map((rejection) => rejection.error.code)).toEqual([
      "duplicate_channel",
    ]);
  });
});
