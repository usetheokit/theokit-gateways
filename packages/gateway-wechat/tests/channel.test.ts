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

const required = wechatChannel.config.filter((f) => f.required);
const secrets = wechatChannel.config.filter((f) => f.secret);
const secretValues = secrets.map((f) => VALUES[f.key] as string).sort();
const prefixed = (name: string | undefined) => `APP_${name}`;
const reject = (source: Record<string, string>) => {
  const env = configFromEnv(descriptor, source, "APP_");
  const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
  return { env, result };
};

describe("wechatChannel", () => {
  it("builds the adapter through createChannels from configFromEnv", () => {
    const { env, result } = reject(ENV);
    expect(env.missing).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(WeChatAdapter);
  });

  it.each(required.map((f) => [prefixed(f.env)]))(
    "a missing %s is rejected naming the full variable",
    (name) => {
      const source = { ...ENV };
      delete source[name as string];
      const { env, result } = reject(source);
      expect(env.missing).toEqual([name]);
      expect(result.rejected[0]?.error.code).toBe("missing_required_config");
      expect(result.rejected[0]?.error.message).toContain(name);
    },
  );

  it("lists exactly the secret values in configFromEnv(...).secrets", () => {
    expect([...configFromEnv(descriptor, ENV, "APP_").secrets].sort()).toEqual(secretValues);
  });

  it.each(required.map((f) => [f.key]))("refuses a wrongly typed %s with invalid_config", (key) => {
    const error = refusal({ ...VALUES, [key as string]: { not: "valid" } });
    expect(error).toBeInstanceOf(GatewayConfigurationError);
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain(key);
  });
});
