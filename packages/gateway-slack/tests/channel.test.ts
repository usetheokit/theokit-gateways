/**
 * `slackChannel` — the Slack channel described as data, bound to environment variables.
 */

import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { SlackAdapter } from "../src/adapter.js";
import { slackChannel } from "../src/channel.js";

const ENV = { APP_SLACK_BOT_TOKEN: "xoxb-secret", APP_SLACK_APP_TOKEN: "xapp-secret" };

function errorOf(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    return err as GatewayConfigurationError;
  }
  throw new Error("expected a GatewayConfigurationError");
}

describe("slackChannel", () => {
  it("is a socket channel", () => {
    expect(slackChannel.platform).toBe("slack");
    expect(slackChannel.transport).toBe("socket");
  });

  it("builds the adapter from configFromEnv", () => {
    const { config, missing } = configFromEnv(slackChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: slackChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(SlackAdapter);
  });

  it.each([
    ["APP_SLACK_BOT_TOKEN", "botToken"],
    ["APP_SLACK_APP_TOKEN", "appToken"],
  ])("reports %s unset, and createChannels rejects it", (variable, key) => {
    const env: Record<string, string> = { ...ENV };
    delete env[variable];
    const { config, missing } = configFromEnv(slackChannel, env, "APP_");
    expect(missing).toEqual([variable]);
    const result = createChannels([{ descriptor: slackChannel, config }]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toBe(`channel slack: missing required config ${key}`);
  });

  it("collects only secret values", () => {
    const env = { ...ENV, APP_SLACK_REQUIRE_MENTION: "true", APP_SLACK_LOG_LEVEL: "info" };
    expect(configFromEnv(slackChannel, env, "APP_").secrets).toEqual([
      "xoxb-secret",
      "xapp-secret",
    ]);
  });

  it("accepts booleans as env strings", () => {
    const config = { botToken: "a", appToken: "b" };
    expect(slackChannel.create({ ...config, requireMention: "false" })).toBeInstanceOf(
      SlackAdapter,
    );
    expect(
      slackChannel.create({ ...config, transport: "socket", logLevel: "warn" }),
    ).toBeInstanceOf(SlackAdapter);
  });

  it.each([
    ["botToken", { botToken: 1, appToken: "b" }],
    ["appToken", { botToken: "a", appToken: 2 }],
    ["botToken", { botToken: "", appToken: "b" }],
    ["appToken", { botToken: "a", appToken: "" }],
    ["requireMention", { botToken: "a", appToken: "b", requireMention: "yes" }],
    ["requireMention", { botToken: "a", appToken: "b", requireMention: null }],
    ["requireMention", { botToken: "a", appToken: "b", requireMention: "" }],
    ["transport", { botToken: "a", appToken: "b", transport: "http" }],
    ["logLevel", { botToken: "a", appToken: "b", logLevel: "loud" }],
  ])("throws invalid_config naming %s", (key, config) => {
    const err = errorOf(() => slackChannel.create(config));
    expect(err.code).toBe("invalid_config");
    expect(err.message).toContain(key);
  });
});
