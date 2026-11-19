import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { NextcloudTalkAdapter } from "../src/adapter.js";
import { ConfigurationError, nextcloudTalkChannel } from "../src/channel.js";

const SECRET = "s".repeat(48);
const PREFIX = "APP_";
const REQUIRED_ENV: Record<string, string> = {
  APP_NEXTCLOUD_TALK_BASE_URL: "https://cloud.example.com",
  APP_NEXTCLOUD_TALK_SECRET: SECRET,
};
const ALL_ENV: Record<string, string> = {
  APP_NEXTCLOUD_TALK_BASE_URL: "https://cloud.example.com",
  APP_NEXTCLOUD_TALK_SECRET: SECRET,
  APP_NEXTCLOUD_TALK_PORT: "3100",
  APP_NEXTCLOUD_TALK_PATH: "/talk",
  APP_NEXTCLOUD_TALK_CONNECT_TIMEOUT_MS: "5000",
};

describe("nextcloudTalkChannel", () => {
  it("declares a webhook transport with a POST webhook part", () => {
    expect(nextcloudTalkChannel.transport).toBe("webhook");
    expect(nextcloudTalkChannel.webhook.methods).toEqual(["POST"]);
  });

  it("builds the adapter from configFromEnv with every required variable set", () => {
    const { config, missing } = configFromEnv(nextcloudTalkChannel, REQUIRED_ENV, PREFIX);
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: nextcloudTalkChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(NextcloudTalkAdapter);
  });

  it("builds the adapter from every variable, converting strings", () => {
    const { config } = configFromEnv(nextcloudTalkChannel, ALL_ENV, PREFIX);
    expect(nextcloudTalkChannel.create(config)).toBeInstanceOf(NextcloudTalkAdapter);
  });

  for (const name of Object.keys(REQUIRED_ENV)) {
    it(`rejects with missing_required_config when ${name} is unset`, () => {
      const env = { ...REQUIRED_ENV };
      delete env[name];
      const { config, missing } = configFromEnv(nextcloudTalkChannel, env, PREFIX);
      expect(missing).toEqual([name]);
      const key = nextcloudTalkChannel.config.find((f) => PREFIX + f.env === name)?.key as string;
      const result = createChannels([{ descriptor: nextcloudTalkChannel, config }]);
      expect(result.adapters).toEqual([]);
      expect(result.rejected[0]?.error.code).toBe("missing_required_config");
      expect(result.rejected[0]?.error.message).toContain(key);
    });
  }

  it("throws invalid_config naming the key for a wrongly typed value", () => {
    const config = {
      ...configFromEnv(nextcloudTalkChannel, REQUIRED_ENV, PREFIX).config,
      baseUrl: 42,
    };
    try {
      nextcloudTalkChannel.create(config);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      expect(err).toBeInstanceOf(GatewayConfigurationError);
      expect((err as ConfigurationError).code).toBe("invalid_config");
      expect((err as ConfigurationError).message).toContain("baseUrl");
    }
  });

  it("lists exactly the expected secret values in configFromEnv secrets", () => {
    const { secrets } = configFromEnv(nextcloudTalkChannel, ALL_ENV, PREFIX);
    expect([...secrets].sort()).toEqual([SECRET].sort());
  });
});

describe("nextcloudTalkChannel conversions", () => {
  it("accepts a number port", () => {
    expect(
      nextcloudTalkChannel.create({ baseUrl: "https://c.example", secret: SECRET, port: 3100 }),
    ).toBeInstanceOf(NextcloudTalkAdapter);
  });
  it("refuses a non-digit port", () => {
    expect(() =>
      nextcloudTalkChannel.create({ baseUrl: "https://c.example", secret: SECRET, port: "x" }),
    ).toThrow(/port/);
  });
  it("reports a secret of the wrong length as invalid_config", () => {
    expect(() =>
      nextcloudTalkChannel.create({ baseUrl: "https://c.example", secret: "short" }),
    ).toThrow(ConfigurationError);
  });
});

describe("nextcloudTalkChannel null and programmatic fields", () => {
  const base = { baseUrl: "https://c.example", secret: SECRET };
  for (const key of ["port", "path", "connectTimeoutMs", "app", "fetch"]) {
    it(`refuses an explicit null ${key}`, () => {
      expect(() => nextcloudTalkChannel.create({ ...base, [key]: null })).toThrow(new RegExp(key));
    });
  }
  it("refuses a function that is not an Express app (no post method)", () => {
    expect(() => nextcloudTalkChannel.create({ ...base, app: () => undefined })).toThrow(/app/);
  });

  it("refuses an app that is not a function", () => {
    expect(() => nextcloudTalkChannel.create({ ...base, app: {} })).toThrow(/app/);
  });
  it("passes app and fetch to the adapter", () => {
    const app = Object.assign(() => undefined, { post: () => undefined, use: () => undefined });
    const fetchFn = async () => new Response("{}");
    const adapter = nextcloudTalkChannel.create({ ...base, app, fetch: fetchFn });
    expect(adapter).toBeInstanceOf(NextcloudTalkAdapter);
    expect((adapter as unknown as { opts: { app: unknown } }).opts.app).toBe(app);
    expect((adapter as unknown as { fetchFn: unknown }).fetchFn).toBeTypeOf("function");
  });
});

describe("nextcloudTalkChannel empty values for non-string fields", () => {
  const base = { baseUrl: "https://c.example", secret: SECRET };
  for (const key of ["port", "connectTimeoutMs", "app"]) {
    it(`refuses an empty string for ${key}`, () => {
      expect(() => nextcloudTalkChannel.create({ ...base, [key]: "" })).toThrow(new RegExp(key));
    });
  }
});
