import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { YuanbaoAdapter } from "../src/adapter.js";
import { yuanbaoChannel } from "../src/channel.js";

const ENV: Record<string, string> = {
  APP_YUANBAO_APP_ID: "appId-value",
  APP_YUANBAO_APP_SECRET: "appSecret-value",
  APP_YUANBAO_CALLBACK_SECRET: "callbackSecret-value",
  APP_YUANBAO_API_BASE: "https://example.test",
};

const VALID = { appId: "x", appSecret: "x", callbackSecret: "x" };

describe("yuanbaoChannel", () => {
  it("builds the adapter from the environment through createChannels", () => {
    const { config } = configFromEnv(yuanbaoChannel, ENV, "APP_");
    const result = createChannels([{ descriptor: yuanbaoChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(YuanbaoAdapter);
  });

  it("builds the adapter from a plain object without optional fields", () => {
    expect(yuanbaoChannel.create(VALID)).toBeInstanceOf(YuanbaoAdapter);
  });

  it("declares platform and the env names", () => {
    expect(yuanbaoChannel.platform).toBe("yuanbao");
    expect(yuanbaoChannel.config.map((f) => f.env)).toEqual([
      "YUANBAO_APP_ID",
      "YUANBAO_APP_SECRET",
      "YUANBAO_CALLBACK_SECRET",
      "YUANBAO_API_BASE",
    ]);
  });

  it("reports YUANBAO_APP_ID as missing and rejects with missing_required_config", () => {
    const env = { ...ENV };
    delete env.APP_YUANBAO_APP_ID;
    const read = configFromEnv(yuanbaoChannel, env, "APP_");
    expect(read.missing).toEqual(["APP_YUANBAO_APP_ID"]);
    const result = createChannels([{ descriptor: yuanbaoChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("appId");
  });

  it("reports YUANBAO_APP_SECRET as missing and rejects with missing_required_config", () => {
    const env = { ...ENV };
    delete env.APP_YUANBAO_APP_SECRET;
    const read = configFromEnv(yuanbaoChannel, env, "APP_");
    expect(read.missing).toEqual(["APP_YUANBAO_APP_SECRET"]);
    const result = createChannels([{ descriptor: yuanbaoChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("appSecret");
  });

  it("reports YUANBAO_CALLBACK_SECRET as missing and rejects with missing_required_config", () => {
    const env = { ...ENV };
    delete env.APP_YUANBAO_CALLBACK_SECRET;
    const read = configFromEnv(yuanbaoChannel, env, "APP_");
    expect(read.missing).toEqual(["APP_YUANBAO_CALLBACK_SECRET"]);
    const result = createChannels([{ descriptor: yuanbaoChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("callbackSecret");
  });

  it("refuses a numeric appId with invalid_config naming the key", () => {
    const config = { ...VALID, appId: 42 };
    let thrown: unknown;
    try {
      yuanbaoChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("appId");
  });

  it("refuses a numeric appSecret with invalid_config naming the key", () => {
    const config = { ...VALID, appSecret: 42 };
    let thrown: unknown;
    try {
      yuanbaoChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("appSecret");
  });

  it("refuses a numeric callbackSecret with invalid_config naming the key", () => {
    const config = { ...VALID, callbackSecret: 42 };
    let thrown: unknown;
    try {
      yuanbaoChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("callbackSecret");
  });

  it("refuses a numeric apiBase with invalid_config naming the key", () => {
    const config = { ...VALID, apiBase: 42 };
    let thrown: unknown;
    try {
      yuanbaoChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("apiBase");
  });

  it("collects exactly the secret values", () => {
    const { secrets } = configFromEnv(yuanbaoChannel, ENV, "APP_");
    expect([...secrets].sort()).toEqual(["appSecret-value", "callbackSecret-value"].sort());
  });
});
