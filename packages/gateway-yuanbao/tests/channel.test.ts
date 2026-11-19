import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { YuanbaoAdapter } from "../src/adapter.js";
import { yuanbaoChannel } from "../src/channel.js";

const ENV = {
  APP_YUANBAO_APP_ID: "ybid",
  APP_YUANBAO_APP_SECRET: "yb-app-secret",
  APP_YUANBAO_CALLBACK_SECRET: "yb-cb-secret",
};
const KEYS: Record<string, string> = {
  APP_YUANBAO_APP_ID: "appId",
  APP_YUANBAO_APP_SECRET: "appSecret",
  APP_YUANBAO_CALLBACK_SECRET: "callbackSecret",
};

describe("yuanbaoChannel", () => {
  it("builds the adapter from the environment through createChannels", () => {
    const { config } = configFromEnv(yuanbaoChannel, ENV, "APP_");
    const result = createChannels([{ descriptor: yuanbaoChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(YuanbaoAdapter);
  });

  it("binds YUANBAO_* variables and is a webhook channel", () => {
    expect(yuanbaoChannel.platform).toBe("yuanbao");
    expect(yuanbaoChannel.transport).toBe("webhook");
    expect(yuanbaoChannel.config.filter((f) => f.required).map((f) => f.env)).toEqual([
      "YUANBAO_APP_ID",
      "YUANBAO_APP_SECRET",
      "YUANBAO_CALLBACK_SECRET",
    ]);
  });

  it.each(Object.keys(ENV))("rejects with missing_required_config when %s is unset", (name) => {
    const env: Record<string, string> = { ...ENV };
    delete env[name];
    const read = configFromEnv(yuanbaoChannel, env, "APP_");
    expect(read.missing).toEqual([name]);
    const result = createChannels([{ descriptor: yuanbaoChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain(KEYS[name]);
  });

  it("refuses a number for callbackSecret with invalid_config naming the key", () => {
    const { config } = configFromEnv(yuanbaoChannel, ENV, "APP_");
    expect(() => yuanbaoChannel.create({ ...config, callbackSecret: 42 })).toThrow(
      expect.objectContaining({
        code: "invalid_config",
        message: expect.stringContaining("callbackSecret"),
      }),
    );
    expect(() => yuanbaoChannel.create({ ...config, callbackSecret: 42 })).toThrow(
      GatewayConfigurationError,
    );
  });

  it("collects exactly the secret values", () => {
    const { secrets } = configFromEnv(yuanbaoChannel, ENV, "APP_");
    expect([...secrets].sort()).toEqual(["yb-app-secret", "yb-cb-secret"]);
  });
});
