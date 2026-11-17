import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { QQAdapter } from "../src/adapter.js";
import { qqChannel } from "../src/channel.js";

const ENV: Record<string, string> = {
  APP_QQ_APP_ID: "appId-value",
  APP_QQ_APP_SECRET: "appSecret-value",
  APP_QQ_TOKEN_URL: "https://example.test",
};

const VALID = { appId: "x", appSecret: "x" };

describe("qqChannel", () => {
  it("builds the adapter from the environment through createChannels", () => {
    const { config } = configFromEnv(qqChannel, ENV, "APP_");
    const result = createChannels([{ descriptor: qqChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(QQAdapter);
  });

  it("builds the adapter from a plain object without optional fields", () => {
    expect(qqChannel.create(VALID)).toBeInstanceOf(QQAdapter);
  });

  it("declares platform and the env names", () => {
    expect(qqChannel.platform).toBe("qq");
    expect(qqChannel.config.map((f) => f.env)).toEqual([
      "QQ_APP_ID",
      "QQ_APP_SECRET",
      "QQ_API_BASE",
      "QQ_TOKEN_URL",
    ]);
  });

  it("reports QQ_APP_ID as missing and rejects with missing_required_config", () => {
    const env = { ...ENV };
    delete env.APP_QQ_APP_ID;
    const read = configFromEnv(qqChannel, env, "APP_");
    expect(read.missing).toEqual(["APP_QQ_APP_ID"]);
    const result = createChannels([{ descriptor: qqChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("appId");
  });

  it("reports QQ_APP_SECRET as missing and rejects with missing_required_config", () => {
    const env = { ...ENV };
    delete env.APP_QQ_APP_SECRET;
    const read = configFromEnv(qqChannel, env, "APP_");
    expect(read.missing).toEqual(["APP_QQ_APP_SECRET"]);
    const result = createChannels([{ descriptor: qqChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("appSecret");
  });

  it("refuses a numeric appId with invalid_config naming the key", () => {
    const config = { ...VALID, appId: 42 };
    let thrown: unknown;
    try {
      qqChannel.create(config);
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
      qqChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("appSecret");
  });

  it("refuses a numeric apiBase with invalid_config naming the key", () => {
    const config = { ...VALID, apiBase: 42 };
    let thrown: unknown;
    try {
      qqChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("apiBase");
  });

  it("refuses a numeric tokenUrl with invalid_config naming the key", () => {
    const config = { ...VALID, tokenUrl: 42 };
    let thrown: unknown;
    try {
      qqChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("tokenUrl");
  });

  it("collects exactly the secret values", () => {
    const { secrets } = configFromEnv(qqChannel, ENV, "APP_");
    expect([...secrets].sort()).toEqual(["appSecret-value"].sort());
  });
});
