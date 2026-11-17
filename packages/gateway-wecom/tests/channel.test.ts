import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { WeComAdapter } from "../src/adapter.js";
import { wecomChannel } from "../src/channel.js";

const ENV = {
  APP_WECOM_CORP_ID: "corp",
  APP_WECOM_CORP_SECRET: "csecret",
  APP_WECOM_AGENT_ID: "1000002",
  APP_WECOM_TOKEN: "tok",
  APP_WECOM_ENCODING_AES_KEY: "a".repeat(43),
};

const VALID = {
  corpId: "corp",
  corpSecret: "csecret",
  agentId: 1000002,
  token: "tok",
  encodingAesKey: "a".repeat(43),
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

describe("wecomChannel", () => {
  it("builds the adapter from configFromEnv", () => {
    const { config, missing } = configFromEnv(wecomChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: wecomChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(WeComAdapter);
  });

  it("rejects with missing_required_config and names the variable", () => {
    for (const field of wecomChannel.config) {
      const env: Record<string, string> = { ...ENV };
      delete env[`APP_${field.env}`];
      const { config, missing } = configFromEnv(wecomChannel, env, "APP_");
      expect(missing).toEqual([`APP_${field.env}`]);
      const { rejected } = createChannels([{ descriptor: wecomChannel, config, envPrefix: "APP_" }]);
      expect(rejected[0]?.error.code).toBe("missing_required_config");
      expect(rejected[0]?.error.message).toContain(`APP_${field.env}`);
    }
  });

  it("collects exactly the secret values", () => {
    expect(configFromEnv(wecomChannel, ENV, "APP_").secrets.toSorted()).toEqual(
      ["csecret", "tok", "a".repeat(43)].toSorted(),
    );
  });

  it("refuses a wrongly typed value naming the key", () => {
    const error = errorOf(() => wecomChannel.create({ ...VALID, corpId: 42 }));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("corpId");
  });

  it("accepts agentId as a number or digit string, else refuses", () => {
    expect(wecomChannel.create({ ...VALID, agentId: "1000002" })).toBeInstanceOf(WeComAdapter);
    for (const bad of ["abc", "", -1, 1.5, true]) {
      const error = errorOf(() => wecomChannel.create({ ...VALID, agentId: bad }));
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain("agentId");
    }
  });

  it("declares socket transport and no webhook", () => {
    expect(wecomChannel.transport).toBe("socket");
    expect("webhook" in wecomChannel).toBe(false);
  });
});
