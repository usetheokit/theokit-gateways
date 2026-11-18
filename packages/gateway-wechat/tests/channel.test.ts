import {
  type ChannelDescriptor,
  configFromEnv,
  createChannels,
  GatewayConfigurationError,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { WeChatAdapter } from "../src/adapter.js";
import { wechatChannel } from "../src/channel.js";

const descriptor = wechatChannel as unknown as ChannelDescriptor;

const ENV: Record<string, string> = {
  APP_WECHAT_APP_ID: "a",
  APP_WECHAT_APP_SECRET: "s",
  APP_WECHAT_TOKEN: "t",
};
const VALUES: Record<string, unknown> = {
  appId: "a",
  appSecret: "s",
  token: "t",
};

function refusal(config: Record<string, unknown>): GatewayConfigurationError {
  try {
    wechatChannel.create(config);
  } catch (err) {
    return err as GatewayConfigurationError;
  }
  throw new Error("create did not throw");
}

describe("wechatChannel", () => {
  it("builds the adapter through createChannels from configFromEnv", () => {
    const env = configFromEnv(descriptor, ENV, "APP_");
    expect(env.missing).toEqual([]);
    const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(WeChatAdapter);
  });

  it.each(["APP_WECHAT_APP_ID", "APP_WECHAT_APP_SECRET", "APP_WECHAT_TOKEN"])(
    "a missing %s is rejected naming the full variable",
    (name) => {
      const source = { ...ENV };
      delete source[name];
      const env = configFromEnv(descriptor, source, "APP_");
      expect(env.missing).toEqual([name]);
      const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
      expect(result.rejected[0]?.error.code).toBe("missing_required_config");
      expect(result.rejected[0]?.error.message).toContain(name);
    },
  );

  it("lists exactly the secret values in configFromEnv(...).secrets", () => {
    const env = configFromEnv(descriptor, ENV, "APP_");
    expect([...env.secrets].sort()).toEqual(["s", "t"]);
    const secretKeys = wechatChannel.config.filter((f) => f.secret).map((f) => f.key);
    expect(secretKeys.map((k) => VALUES[k]).sort()).toEqual(["s", "t"]);
  });

  it.each(["appId", "appSecret", "token"])(
    "refuses a wrongly typed %s with invalid_config",
    (key) => {
      const error = refusal({ ...VALUES, [key]: { not: "valid" } });
      expect(error).toBeInstanceOf(GatewayConfigurationError);
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(key);
    },
  );
});
