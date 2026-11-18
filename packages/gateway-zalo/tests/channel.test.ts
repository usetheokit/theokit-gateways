import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { ZaloAdapter } from "../src/adapter.js";
import { zaloChannel } from "../src/channel.js";

const ENV: Record<string, string> = {
  APP_ZALO_APP_ID: "appId-value",
  APP_ZALO_OA_SECRET_KEY: "oaSecretKey-value",
  APP_ZALO_ACCESS_TOKEN: "accessToken-value",
  APP_ZALO_API_BASE: "https://example.test",
};

const VALID = { appId: "x", oaSecretKey: "x", accessToken: "x" };

describe("zaloChannel", () => {
  it("builds the adapter from the environment through createChannels", () => {
    const { config } = configFromEnv(zaloChannel, ENV, "APP_");
    const result = createChannels([{ descriptor: zaloChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(ZaloAdapter);
  });

  it("builds the adapter from a plain object without optional fields", () => {
    expect(zaloChannel.create(VALID)).toBeInstanceOf(ZaloAdapter);
  });

  it("declares platform and the env names", () => {
    expect(zaloChannel.platform).toBe("zalo");
    expect(zaloChannel.config.map((f) => f.env)).toEqual([
      "ZALO_APP_ID",
      "ZALO_OA_SECRET_KEY",
      "ZALO_ACCESS_TOKEN",
      "ZALO_API_BASE",
    ]);
  });

  it("reports ZALO_APP_ID as missing and rejects with missing_required_config", () => {
    const env = { ...ENV };
    delete env.APP_ZALO_APP_ID;
    const read = configFromEnv(zaloChannel, env, "APP_");
    expect(read.missing).toEqual(["APP_ZALO_APP_ID"]);
    const result = createChannels([{ descriptor: zaloChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("appId");
  });

  it("reports ZALO_OA_SECRET_KEY as missing and rejects with missing_required_config", () => {
    const env = { ...ENV };
    delete env.APP_ZALO_OA_SECRET_KEY;
    const read = configFromEnv(zaloChannel, env, "APP_");
    expect(read.missing).toEqual(["APP_ZALO_OA_SECRET_KEY"]);
    const result = createChannels([{ descriptor: zaloChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("oaSecretKey");
  });

  it("reports ZALO_ACCESS_TOKEN as missing and rejects with missing_required_config", () => {
    const env = { ...ENV };
    delete env.APP_ZALO_ACCESS_TOKEN;
    const read = configFromEnv(zaloChannel, env, "APP_");
    expect(read.missing).toEqual(["APP_ZALO_ACCESS_TOKEN"]);
    const result = createChannels([{ descriptor: zaloChannel, config: read.config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("accessToken");
  });

  it("refuses a numeric appId with invalid_config naming the key", () => {
    const config = { ...VALID, appId: 42 };
    let thrown: unknown;
    try {
      zaloChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("appId");
  });

  it("refuses a numeric oaSecretKey with invalid_config naming the key", () => {
    const config = { ...VALID, oaSecretKey: 42 };
    let thrown: unknown;
    try {
      zaloChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("oaSecretKey");
  });

  it("refuses a numeric accessToken with invalid_config naming the key", () => {
    const config = { ...VALID, accessToken: 42 };
    let thrown: unknown;
    try {
      zaloChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("accessToken");
  });

  it("refuses a numeric apiBase with invalid_config naming the key", () => {
    const config = { ...VALID, apiBase: 42 };
    let thrown: unknown;
    try {
      zaloChannel.create(config);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("apiBase");
  });

  it("collects exactly the secret values", () => {
    const { secrets } = configFromEnv(zaloChannel, ENV, "APP_");
    expect([...secrets].sort()).toEqual(["oaSecretKey-value", "accessToken-value"].sort());
  });

  it("refuses a numeric optional apiBase with invalid_config naming the key", () => {
    expect(() => zaloChannel.create({ ...VALID, apiBase: 5 })).toThrow(/apiBase/);
  });

  it("passes a supplied fetch through to the adapter", async () => {
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(url);
      return { status: 200, text: async () => "{}" };
    };
    const adapter = zaloChannel.create({ ...VALID, fetch });
    await adapter.connect();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("refuses a fetch that is not a function with invalid_config naming the key", () => {
    let thrown: unknown;
    try {
      zaloChannel.create({ ...VALID, fetch: "nope" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GatewayConfigurationError);
    expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
    expect((thrown as Error).message).toContain("fetch");
  });

  it("is a webhook channel whose handle refuses an unsigned request with 401", async () => {
    expect(zaloChannel.transport).toBe("webhook");
    const adapter = zaloChannel.create(VALID);
    const answer = await zaloChannel.webhook.handle(adapter, { rawBody: "{}", headers: {} });
    expect(answer.status).toBe(401);
  });
});
