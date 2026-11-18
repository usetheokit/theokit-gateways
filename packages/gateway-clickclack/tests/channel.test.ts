import {
  GatewayConfigurationError as ConfigurationError,
  configFromEnv,
  createChannels,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { ClickClackAdapter } from "../src/adapter.js";
import { clickclackChannel } from "../src/channel.js";

const ENV = {
  APP_CLICKCLACK_BASE_URL: "https://chat.example.com",
  APP_CLICKCLACK_TOKEN: "tok-secret",
  APP_CLICKCLACK_WORKSPACE_ID: "ws1",
  APP_CLICKCLACK_BOT_USER_ID: "bot1",
};

function errorOf(fn: () => unknown): ConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigurationError);
    return err as ConfigurationError;
  }
  throw new Error("nothing was thrown");
}

describe("clickclackChannel", () => {
  it("declares a socket channel", () => {
    expect(clickclackChannel.platform).toBe("clickclack");
    expect(clickclackChannel.transport).toBe("socket");
  });

  it("builds the adapter from configFromEnv with every required variable set", () => {
    const { config, missing } = configFromEnv(clickclackChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const { adapters, rejected } = createChannels([
      { envPrefix: "APP_", descriptor: clickclackChannel, config },
    ]);
    expect(rejected).toEqual([]);
    expect(adapters[0]).toBeInstanceOf(ClickClackAdapter);
  });

  it.each(Object.keys(ENV))("rejects the channel when %s is unset", (name) => {
    const env: Record<string, string> = { ...ENV };
    delete env[name];
    const { config, missing } = configFromEnv(clickclackChannel, env, "APP_");
    expect(missing).toEqual([name]);
    const { rejected } = createChannels([
      { envPrefix: "APP_", descriptor: clickclackChannel, config },
    ]);
    expect(rejected[0]?.error.code).toBe("missing_required_config");
    // The unset variable's full prefixed name maps to the config key the rejection names.
    const field = clickclackChannel.config.find((f) => `APP_${f.env}` === name);
    expect(field).toBeDefined();
    expect(name).toBe(`APP_${field?.env}`);
    expect(name.startsWith("APP_")).toBe(true);
    expect(missing).toContain(name);
    expect(rejected[0]?.error.message).toMatch(
      new RegExp(`^channel clickclack: missing required config \\w+ \\(env ${name}\\)$`),
    );
  });

  it("throws invalid_config naming the key for a wrongly typed value", () => {
    const config = { baseUrl: "https://x", token: 42, workspaceId: "w", botUserId: "b" };
    const error = errorOf(() => clickclackChannel.create(config));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("token");
    const bad = { ...config, token: "t", reconnectDelayMs: "soon" };
    expect(errorOf(() => clickclackChannel.create(bad)).message).toContain("reconnectDelayMs");
  });

  it("refuses an explicit null reconnectDelayMs", () => {
    const config = {
      ...configFromEnv(clickclackChannel, ENV, "APP_").config,
      reconnectDelayMs: null,
    };
    const error = errorOf(() => clickclackChannel.create(config));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("reconnectDelayMs");
  });

  it("refuses a digit string that overflows to Infinity", () => {
    const config = {
      ...configFromEnv(clickclackChannel, ENV, "APP_").config,
      reconnectDelayMs: "9".repeat(400),
    };
    const error = errorOf(() => clickclackChannel.create(config));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("reconnectDelayMs");
  });

  it("accepts a digit string for reconnectDelayMs", () => {
    const config = {
      ...configFromEnv(clickclackChannel, ENV, "APP_").config,
      reconnectDelayMs: "250",
    };
    expect(clickclackChannel.create(config)).toBeInstanceOf(ClickClackAdapter);
  });

  it("lists exactly the secret fields' values in secrets", () => {
    const env = { ...ENV, APP_CLICKCLACK_RECONNECT_DELAY_MS: "250" };
    expect(configFromEnv(clickclackChannel, env, "APP_").secrets).toEqual(["tok-secret"]);
    expect(clickclackChannel.config.filter((f) => f.secret).map((f) => f.key)).toEqual(["token"]);
  });
});
