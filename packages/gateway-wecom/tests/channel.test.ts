import {
  type ChannelDescriptor,
  configFromEnv,
  createChannels,
  GatewayConfigurationError,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { WeComAdapter } from "../src/adapter.js";
import { wecomChannel } from "../src/channel.js";

const descriptor = wecomChannel as unknown as ChannelDescriptor;

const ENV: Record<string, string> = {
  APP_WECOM_CORP_ID: "c",
  APP_WECOM_CORP_SECRET: "s",
  APP_WECOM_AGENT_ID: "1000002",
  APP_WECOM_TOKEN: "t",
  APP_WECOM_ENCODING_AES_KEY: "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
};
const VALUES: Record<string, unknown> = {
  corpId: "c",
  corpSecret: "s",
  agentId: "1000002",
  token: "t",
  encodingAesKey: "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
};

function refusal(config: Record<string, unknown>): GatewayConfigurationError {
  try {
    wecomChannel.create(config);
  } catch (err) {
    return err as GatewayConfigurationError;
  }
  throw new Error("create did not throw");
}

describe("wecomChannel", () => {
  it("builds the adapter through createChannels from configFromEnv", () => {
    const env = configFromEnv(descriptor, ENV, "APP_");
    expect(env.missing).toEqual([]);
    const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(WeComAdapter);
  });

  it.each([
    "APP_WECOM_CORP_ID",
    "APP_WECOM_CORP_SECRET",
    "APP_WECOM_AGENT_ID",
    "APP_WECOM_TOKEN",
    "APP_WECOM_ENCODING_AES_KEY",
  ])("a missing %s is rejected naming the full variable", (name) => {
    const source = { ...ENV };
    delete source[name];
    const env = configFromEnv(descriptor, source, "APP_");
    expect(env.missing).toEqual([name]);
    const result = createChannels([{ descriptor, config: env.config, envPrefix: "APP_" }]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain(name);
  });

  it("lists exactly the secret values in configFromEnv(...).secrets", () => {
    const env = configFromEnv(descriptor, ENV, "APP_");
    expect([...env.secrets].sort()).toEqual([
      "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
      "s",
      "t",
    ]);
    const secretKeys = wecomChannel.config.filter((f) => f.secret).map((f) => f.key);
    expect(secretKeys.map((k) => VALUES[k]).sort()).toEqual([
      "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
      "s",
      "t",
    ]);
  });

  it.each(["corpId", "corpSecret", "agentId", "token", "encodingAesKey"])(
    "refuses a wrongly typed %s with invalid_config",
    (key) => {
      const error = refusal({ ...VALUES, [key]: { not: "valid" } });
      expect(error).toBeInstanceOf(GatewayConfigurationError);
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(key);
    },
  );

  it("accepts agentId as a number or a digit string and refuses other shapes", () => {
    expect(wecomChannel.create({ ...VALUES, agentId: 1000002 })).toBeInstanceOf(WeComAdapter);
    expect(refusal({ ...VALUES, agentId: "abc" }).message).toContain("agentId");
  });
});
