import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { QQAdapter } from "../src/adapter.js";
import { qqChannel } from "../src/channel.js";

const ENV = {
  "APP_QQ_APP_ID": "app-1",
  "APP_QQ_APP_SECRET": "s3cret-qq"
};
const KEYS: Record<string, string> = {"APP_QQ_APP_ID": "appId", "APP_QQ_APP_SECRET": "appSecret"};

describe("qqChannel", () => {
  it("builds the adapter from the environment through createChannels", () => {
    const { config } = configFromEnv(qqChannel, ENV, "APP_");
    const result = createChannels([{ descriptor: qqChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(QQAdapter);
  });

  it("binds QQ_* variables and is a webhook channel", () => {
    expect(qqChannel.platform).toBe("qq");
    expect(qqChannel.transport).toBe("webhook");
    expect(qqChannel.config.filter((f) => f.required).map((f) => f.env)).toEqual(
      ["QQ_APP_ID", "QQ_APP_SECRET"],
    );
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

  it("refuses a number for apiBase with invalid_config naming the key", () => {
    const { config } = configFromEnv(qqChannel, ENV, "APP_");
    expect(() => qqChannel.create({ ...config, apiBase: 42 })).toThrow(
      expect.objectContaining({
        code: "invalid_config",
        message: expect.stringContaining("apiBase"),
      }),
    );
    expect(() => qqChannel.create({ ...config, apiBase: 42 })).toThrow(GatewayConfigurationError);
  });

  it("collects exactly the secret values", () => {
    const { secrets } = configFromEnv(qqChannel, ENV, "APP_");
    expect([...secrets].sort()).toEqual(["s3cret-qq"]);
  });

  it("answers an unsigned webhook with 401 and no body", async () => {
    const adapter = qqChannel.create({ appId: "a", appSecret: "b" });
    const answer = await qqChannel.webhook.handle(adapter, { rawBody: "{}", headers: {} });
    expect(answer.status).toBe(401);
  });
});
