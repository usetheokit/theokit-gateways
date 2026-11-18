import {
  GatewayConfigurationError as ConfigurationError,
  configFromEnv,
  createChannels,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";
import { FeishuLarkAdapter } from "../src/adapter.js";
import { feishuLarkChannel } from "../src/channel.js";

const ENV = {
  APP_FEISHU_LARK_APP_ID: "cli_0123456789abcdef",
  APP_FEISHU_LARK_APP_SECRET: "shh-secret",
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

describe("feishuLarkChannel", () => {
  it("declares a socket channel", () => {
    expect(feishuLarkChannel.platform).toBe("feishu_lark");
    expect(feishuLarkChannel.transport).toBe("socket");
  });

  it("builds the adapter from configFromEnv with every required variable set", () => {
    const { config, missing } = configFromEnv(feishuLarkChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const { adapters, rejected } = createChannels([{ descriptor: feishuLarkChannel, config }]);
    expect(rejected).toEqual([]);
    expect(adapters[0]).toBeInstanceOf(FeishuLarkAdapter);
  });

  it.each(Object.keys(ENV))("rejects the channel when %s is unset", (name) => {
    const env: Record<string, string> = { ...ENV };
    delete env[name];
    const { config, missing } = configFromEnv(feishuLarkChannel, env, "APP_");
    expect(missing).toEqual([name]);
    const { rejected } = createChannels([{ descriptor: feishuLarkChannel, config }]);
    expect(rejected[0]?.error.code).toBe("missing_required_config");
    // The unset variable's full prefixed name maps to the config key the rejection names.
    const field = feishuLarkChannel.config.find((f) => `APP_${f.env}` === name);
    expect(field).toBeDefined();
    expect(name).toBe(`APP_${field?.env}`);
    expect(name.startsWith("APP_")).toBe(true);
    expect(missing).toContain(name);
    expect(rejected[0]?.error.message).toBe(
      `channel feishu_lark: missing required config ${field?.key}`,
    );
  });

  it("throws invalid_config naming the key for a wrongly typed value", () => {
    const error = errorOf(() =>
      feishuLarkChannel.create({ appId: "cli_0123456789abcdef", appSecret: 7 }),
    );
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("appSecret");
  });

  it("refuses a malformed appId and an unknown domain", () => {
    expect(
      errorOf(() => feishuLarkChannel.create({ appId: "nope", appSecret: "s" })).message,
    ).toContain("appId");
    const bad = { appId: "cli_0123456789abcdef", appSecret: "s", domain: "other" };
    const error = errorOf(() => feishuLarkChannel.create(bad));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("domain");
  });

  it("rejects an explicit null domain", () => {
    const config = { appId: "cli_0123456789abcdef", appSecret: "s", domain: null };
    expect(errorOf(() => feishuLarkChannel.create(config)).message).toContain("domain");
  });

  it("rejects an uppercase cli_ prefix through createChannels, not as a defect", () => {
    const config = { appId: "CLI_0123456789abcdef", appSecret: "s" };
    const { rejected } = createChannels([{ descriptor: feishuLarkChannel, config }]);
    expect(rejected[0]?.error.code).toBe("invalid_config");
    expect(rejected[0]?.error.message).toContain("appId");
  });

  it("lists exactly the secret fields' values in secrets", () => {
    const env = { ...ENV, APP_FEISHU_LARK_DOMAIN: "lark" };
    expect(configFromEnv(feishuLarkChannel, env, "APP_").secrets).toEqual(["shh-secret"]);
  });
});
