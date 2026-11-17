import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { TwitchAdapter } from "../src/adapter.js";
import { twitchChannel } from "../src/channel.js";

const ENV = {
  APP_TWITCH_ACCESS_TOKEN: "oauth-secret-token",
  APP_TWITCH_BOT_USER_ID: "123",
  APP_TWITCH_BROADCASTER_USER_IDS: "456, 789",
};
const KEYS: Record<string, string> = {
  APP_TWITCH_ACCESS_TOKEN: "accessToken",
  APP_TWITCH_BOT_USER_ID: "botUserId",
  APP_TWITCH_BROADCASTER_USER_IDS: "broadcasterUserIds",
};
const VALID = { accessToken: "t", botUserId: "1", broadcasterUserIds: ["2"] };

function errorOf(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    return err as GatewayConfigurationError;
  }
  throw new Error("nothing was thrown");
}

describe("twitchChannel", () => {
  it("builds the adapter through createChannels from configFromEnv", () => {
    const { config, missing } = configFromEnv(twitchChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: twitchChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(TwitchAdapter);
  });

  it.each(Object.keys(ENV))("rejects with missing_required_config when %s is unset", (name) => {
    const rest = { ...ENV } as Record<string, string>;
    delete rest[name];
    const { config, missing } = configFromEnv(twitchChannel, rest, "APP_");
    expect(name).toMatch(/^APP_TWITCH_/);
    expect(missing).toEqual([name]);
    const { rejected } = createChannels([{ descriptor: twitchChannel, config }]);
    expect(rejected[0]?.error.code).toBe("missing_required_config");
    expect(rejected[0]?.error.message).toContain(KEYS[name] as string);
    // The factory message names the config key; the descriptor binds that key to the full variable.
    const field = twitchChannel.config.find((f) => f.key === KEYS[name]);
    expect(`APP_${field?.env}`).toBe(name);
  });

  it("accepts broadcasterUserIds as an array or a comma-separated string", () => {
    expect(twitchChannel.create(VALID)).toBeInstanceOf(TwitchAdapter);
    expect(twitchChannel.create({ ...VALID, broadcasterUserIds: "2,3" })).toBeInstanceOf(
      TwitchAdapter,
    );
  });

  it.each([
    ["accessToken", 42],
    ["botUserId", 42],
    ["broadcasterUserIds", 42],
    ["broadcasterUserIds", [1]],
    ["broadcasterUserIds", "abc"],
    ["broadcasterUserIds", ""],
    ["eventSubUrl", 1],
    ["fetch", "x"],
    ["socketFactory", "x"],
    ["eventSubUrl", null],
    ["fetch", null],
  ])("throws invalid_config naming %s for a wrongly typed value", (key, value) => {
    const error = errorOf(() => twitchChannel.create({ ...VALID, [key]: value }));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain(`config.${key}`);
    expect(error.message).toContain("gateway-twitch");
  });

  it("reports exactly the secret fields in configFromEnv(...).secrets", () => {
    const full = { ...ENV, APP_TWITCH_EVENT_SUB_URL: "wss://example.test/ws" };
    const { secrets, config } = configFromEnv(twitchChannel, full, "APP_");
    expect(Object.keys(config)).toHaveLength(4);
    expect(secrets).toEqual(["oauth-secret-token"]);
  });

  it("declares socket transport", () => {
    expect(twitchChannel.transport).toBe("socket");
  });
});
