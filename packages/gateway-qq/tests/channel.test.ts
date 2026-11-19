import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { QQAdapter } from "../src/adapter.js";
import { qqChannel } from "../src/channel.js";

const KEYS: Record<string, string> = {
  APP_QQ_APP_ID: "appId",
  APP_QQ_APP_SECRET: "appSecret",
};
const ENV = {
  APP_QQ_APP_ID: "app-1",
  APP_QQ_APP_SECRET: "s3cret-qq",
};

describe("qqChannel", () => {
  it("builds the adapter from the environment through createChannels", () => {
    const { config } = configFromEnv(qqChannel, ENV, "APP_");
    const result = createChannels([{ descriptor: qqChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(QQAdapter);
    expect(qqChannel.transport).toBe("webhook");
  });

  it.each(Object.keys(ENV))("rejects with missing_required_config when %s is unset", (name) => {
    const env: Record<string, string> = { ...ENV };
    delete env[name];
    const read = configFromEnv(qqChannel, env, "APP_");
    expect(read.missing).toEqual([name]);
    const result = createChannels([{ descriptor: qqChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain(KEYS[name]);
  });

  it("refuses a number for appSecret with invalid_config naming the key", () => {
    const { config } = configFromEnv(qqChannel, ENV, "APP_");
    const build = () => qqChannel.create({ ...config, appSecret: 42 });
    expect(build).toThrow(GatewayConfigurationError);
    expect(build).toThrow(
      expect.objectContaining({
        code: "invalid_config",
        message: expect.stringContaining("appSecret"),
      }),
    );
  });

  it("collects exactly the secret values", () => {
    expect([...configFromEnv(qqChannel, ENV, "APP_").secrets].sort()).toEqual(["s3cret-qq"]);
  });
});
