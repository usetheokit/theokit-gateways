import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { SynologyChatAdapter } from "../src/adapter.js";
import { synologyChatChannel } from "../src/channel.js";
import { BOT_TOKEN, INCOMING_URL } from "./fixtures.js";

const ENV = {
  APP_SYNOLOGY_CHAT_BOT_TOKEN: BOT_TOKEN,
  APP_SYNOLOGY_CHAT_INCOMING_URL: INCOMING_URL,
};

function errorOf(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    return err as GatewayConfigurationError;
  }
  throw new Error("nothing was thrown");
}

describe("synologyChatChannel", () => {
  it("builds the adapter through createChannels from configFromEnv", () => {
    const { config, missing } = configFromEnv(synologyChatChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: synologyChatChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(SynologyChatAdapter);
  });

  it.each(Object.keys(ENV))("rejects with missing_required_config when %s is unset", (name) => {
    const { [name as keyof typeof ENV]: _omit, ...rest } = ENV;
    const { config, missing } = configFromEnv(synologyChatChannel, rest, "APP_");
    expect(name).toMatch(/^APP_SYNOLOGY_CHAT_/);
    expect(missing).toEqual([name]);
    const key = name === "APP_SYNOLOGY_CHAT_BOT_TOKEN" ? "botToken" : "incomingUrl";
    const { rejected } = createChannels([
      { descriptor: synologyChatChannel, config, envPrefix: "APP_" },
    ]);
    expect(rejected[0]?.error.code).toBe("missing_required_config");
    // The message names the config key and the full prefixed variable.
    const field = synologyChatChannel.config.find((f) => f.key === key);
    expect(`APP_${field?.env}`).toBe(name);
    expect(rejected[0]?.error.message).toBe(
      `channel ${synologyChatChannel.platform}: missing required config ${key} (env ${name})`,
    );
  });

  it("accepts numeric strings for port and connectTimeoutMs", () => {
    const adapter = synologyChatChannel.create({
      botToken: BOT_TOKEN,
      incomingUrl: INCOMING_URL,
      port: "8080",
      connectTimeoutMs: "500",
    });
    expect(adapter).toBeInstanceOf(SynologyChatAdapter);
  });

  it.each([
    ["botToken", 42],
    ["incomingUrl", 42],
    ["path", 1],
    ["port", "eighty"],
    ["connectTimeoutMs", true],
    ["app", "x"],
    ["app", {}],
    ["fetch", "x"],
    ["port", null],
    ["path", null],
    ["port", ""],
    ["fetch", null],
    ["app", null],
  ])("throws invalid_config naming %s for a wrongly typed value", (key, value) => {
    const error = errorOf(() =>
      synologyChatChannel.create({ botToken: BOT_TOKEN, incomingUrl: INCOMING_URL, [key]: value }),
    );
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain(`config.${key}`);
    expect(error.message).toContain("gateway-synology-chat");
  });

  it("translates a refused incoming URL into invalid_config", () => {
    const error = errorOf(() =>
      synologyChatChannel.create({ botToken: BOT_TOKEN, incomingUrl: "not a url" }),
    );
    expect(error.code).toBe("invalid_config");
    expect(error.detail).toBe("incomingUrl");
  });

  it("reports exactly the secret fields in configFromEnv(...).secrets", () => {
    const full = {
      ...ENV,
      APP_SYNOLOGY_CHAT_PATH: "/hook-path",
      APP_SYNOLOGY_CHAT_PORT: "8081",
      APP_SYNOLOGY_CHAT_CONNECT_TIMEOUT_MS: "1234",
    };
    const { secrets, config } = configFromEnv(synologyChatChannel, full, "APP_");
    expect(Object.keys(config)).toHaveLength(5);
    expect(secrets).toEqual([BOT_TOKEN]);
  });

  it("declares socket transport and the SYNOLOGY_CHAT_ env names", () => {
    expect(synologyChatChannel.transport).toBe("socket");
    expect(synologyChatChannel.config.map((f) => f.env).filter(Boolean)).toEqual([
      "SYNOLOGY_CHAT_BOT_TOKEN",
      "SYNOLOGY_CHAT_INCOMING_URL",
      "SYNOLOGY_CHAT_PATH",
      "SYNOLOGY_CHAT_PORT",
      "SYNOLOGY_CHAT_CONNECT_TIMEOUT_MS",
    ]);
  });
});
