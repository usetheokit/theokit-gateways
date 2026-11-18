import {
  configFromEnv,
  createChannels,
  GatewayConfigurationError,
} from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { QQAdapter } from "../src/adapter.js";
import { qqChannel } from "../src/channel.js";

const REQUIRED = ["appId", "appSecret"];
const OPTIONAL = ["apiBase", "tokenUrl"];
const SECRET = ["appSecret"];
const envName = (key: string): string =>
  "APP_QQ_" + key.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase();
const ENV: Record<string, string> = Object.fromEntries(
  [...REQUIRED, ...OPTIONAL].map((key) => [envName(key), key + "-value"]),
);
const VALID = Object.fromEntries(REQUIRED.map((key) => [key, "x"]));

function thrownBy(config: Record<string, unknown>): unknown {
  try {
    qqChannel.create(config);
  } catch (err) {
    return err;
  }
  return undefined;
}

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
    expect(qqChannel.config.map((f) => f.env)).toEqual(
      [...REQUIRED, ...OPTIONAL].map((key) => envName(key).replace("APP_", "")),
    );
  });

  it.each(REQUIRED)(
    "rejects with missing_required_config when %s is unset",
    (key) => {
      const env = { ...ENV };
      delete env[envName(key)];
      const read = configFromEnv(qqChannel, env, "APP_");
      expect(read.missing).toEqual([envName(key)]);
      const result = createChannels([
        { descriptor: qqChannel, config: read.config },
      ]);
      expect(result.adapters).toEqual([]);
      expect(result.rejected[0]?.error.code).toBe("missing_required_config");
      expect(result.rejected[0]?.error.message).toContain(key);
    },
  );

  it.each([...REQUIRED, ...OPTIONAL, "fetch"])(
    "refuses a wrongly typed %s with invalid_config naming the key",
    (key) => {
      const thrown = thrownBy({
        ...VALID,
        [key]: key === "fetch" ? "nope" : 42,
      });
      expect(thrown).toBeInstanceOf(GatewayConfigurationError);
      expect((thrown as GatewayConfigurationError).code).toBe("invalid_config");
      expect((thrown as Error).message).toContain(key);
    },
  );

  it("collects exactly the secret values", () => {
    const { secrets } = configFromEnv(qqChannel, ENV, "APP_");
    expect([...secrets].sort()).toEqual(
      SECRET.map((key) => key + "-value").sort(),
    );
  });

  it("passes a supplied fetch through to the adapter", async () => {
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(url);
      return { status: 200, text: async () => "{}" };
    };
    await qqChannel.create({ ...VALID, fetch }).connect();
    expect(calls.length).toBeGreaterThan(0);
  });

  it("is a webhook channel whose handle refuses an unsigned request with 401", async () => {
    expect(qqChannel.transport).toBe("webhook");
    const answer = await qqChannel.webhook.handle(qqChannel.create(VALID), {
      rawBody: "{}",
      headers: {},
    });
    expect(answer.status).toBe(401);
  });
});
