/**
 * `discordChannel` — the Discord channel described as data, bound to environment variables.
 */

import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { DiscordAdapter } from "../src/adapter.js";
import { discordChannel } from "../src/channel.js";

const ENV = { APP_DISCORD_TOKEN: "discord-secret-token" };

function errorOf(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    return err as GatewayConfigurationError;
  }
  throw new Error("expected a GatewayConfigurationError");
}

describe("discordChannel", () => {
  it("is a socket channel", () => {
    expect(discordChannel.platform).toBe("discord");
    expect(discordChannel.transport).toBe("socket");
  });

  it("builds the adapter from configFromEnv", () => {
    const { config, missing } = configFromEnv(discordChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: discordChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(DiscordAdapter);
  });

  it("reports the unset variable, and createChannels rejects it", () => {
    const { config, missing } = configFromEnv(discordChannel, {}, "APP_");
    expect(missing).toEqual(["APP_DISCORD_TOKEN"]);
    const result = createChannels([{ descriptor: discordChannel, config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toBe(
      "channel discord: missing required config token",
    );
  });

  it("collects only secret values", () => {
    const env = {
      ...ENV,
      APP_DISCORD_INTENTS: "1,2",
      APP_DISCORD_REQUIRE_MENTION: "false",
    };
    expect(configFromEnv(discordChannel, env, "APP_").secrets).toEqual(["discord-secret-token"]);
  });

  it("accepts intents and booleans as env strings", () => {
    expect(
      discordChannel.create({ token: "t", intents: "1, 512", requireMention: "false" }),
    ).toBeInstanceOf(DiscordAdapter);
    expect(discordChannel.create({ token: "t", intents: [1, "2"] })).toBeInstanceOf(DiscordAdapter);
  });

  it.each([
    ["token", { token: 5 }],
    ["intents", { token: "t", intents: "1,x" }],
    ["intents", { token: "t", intents: "," }],
    ["intents", { token: "t", intents: "1,,2" }],
    ["intents", { token: "t", intents: { a: 1 } }],
    ["requireMention", { token: "t", requireMention: "yes" }],
    ["requireMention", { token: "t", requireMention: 1 }],
    ["requireMention", { token: "t", requireMention: null }],
    ["requireMention", { token: "t", requireMention: "" }],
  ])("throws invalid_config naming %s", (key, config) => {
    const err = errorOf(() => discordChannel.create(config));
    expect(err.code).toBe("invalid_config");
    expect(err.message).toContain(key);
  });
});
