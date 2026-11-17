import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { WeChatAdapter } from "../src/adapter.js";
import { wechatChannel } from "../src/channel.js";

const ENV = {
  APP_WECHAT_APP_ID: "wx1",
  APP_WECHAT_APP_SECRET: "secret",
  APP_WECHAT_TOKEN: "tok",
};

function errorOf(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    return err as GatewayConfigurationError;
  }
  throw new Error("nothing thrown");
}

describe("wechatChannel", () => {
  it("builds the adapter from configFromEnv", () => {
    const { config, missing } = configFromEnv(wechatChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: wechatChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(WeChatAdapter);
  });

  it("rejects with missing_required_config and names the variable", () => {
    for (const field of wechatChannel.config) {
      const env: Record<string, string> = { ...ENV };
      delete env[`APP_${field.env}`];
      const { config, missing } = configFromEnv(wechatChannel, env, "APP_");
      expect(missing).toEqual([`APP_${field.env}`]);
      const { rejected } = createChannels([{ descriptor: wechatChannel, config }]);
      expect(rejected[0]?.error.code).toBe("missing_required_config");
      expect(rejected[0]?.error.message).toContain(field.key);
    }
  });

  it("collects exactly the secret values", () => {
    expect(configFromEnv(wechatChannel, ENV, "APP_").secrets.toSorted()).toEqual(["secret", "tok"]);
  });

  it("refuses a wrongly typed value naming the key", () => {
    const error = errorOf(() =>
      wechatChannel.create({ appId: 42, appSecret: "secret", token: "tok" }),
    );
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("appId");
  });

  it("declares socket transport and no webhook", () => {
    expect(wechatChannel.transport).toBe("socket");
    expect("webhook" in wechatChannel).toBe(false);
  });
});
