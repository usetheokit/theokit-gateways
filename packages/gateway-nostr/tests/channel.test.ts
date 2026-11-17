import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { NostrAdapter } from "../src/adapter.js";
import { ConfigurationError, nostrChannel } from "../src/channel.js";

const KEY = "11".repeat(32);
const PREFIX = "APP_";
const REQUIRED_ENV: Record<string, string> = {
  APP_NOSTR_SECRET_KEY: KEY,
  APP_NOSTR_RELAYS: "wss://relay.example.com",
};
const ALL_ENV: Record<string, string> = {
  APP_NOSTR_SECRET_KEY: KEY,
  APP_NOSTR_RELAYS: "wss://relay.example.com, wss://relay2.example.com",
  APP_NOSTR_IGNORE_BEFORE: "1700000000",
};

describe("nostrChannel", () => {
  it("declares a socket transport and no webhook part", () => {
    expect(nostrChannel.transport).toBe("socket");
    expect("webhook" in nostrChannel).toBe(false);
  });

  it("builds the adapter from configFromEnv with every required variable set", () => {
    const { config, missing } = configFromEnv(nostrChannel, REQUIRED_ENV, PREFIX);
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: nostrChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(NostrAdapter);
  });

  it("builds the adapter from every variable, converting strings", () => {
    const { config } = configFromEnv(nostrChannel, ALL_ENV, PREFIX);
    expect(nostrChannel.create(config)).toBeInstanceOf(NostrAdapter);
  });

  for (const name of Object.keys(REQUIRED_ENV)) {
    it(`rejects with missing_required_config when ${name} is unset`, () => {
      const env = { ...REQUIRED_ENV };
      delete env[name];
      const { config, missing } = configFromEnv(nostrChannel, env, PREFIX);
      expect(missing).toEqual([name]);
      const key = nostrChannel.config.find((f) => PREFIX + f.env === name)?.key as string;
      const result = createChannels([{ descriptor: nostrChannel, config }]);
      expect(result.adapters).toEqual([]);
      expect(result.rejected[0]?.error.code).toBe("missing_required_config");
      expect(result.rejected[0]?.error.message).toContain(key);
    });
  }

  it("throws invalid_config naming the key for a wrongly typed value", () => {
    const config = { ...configFromEnv(nostrChannel, REQUIRED_ENV, PREFIX).config, secretKey: 42 };
    try {
      nostrChannel.create(config);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      expect(err).toBeInstanceOf(GatewayConfigurationError);
      expect((err as ConfigurationError).code).toBe("invalid_config");
      expect((err as ConfigurationError).message).toContain("secretKey");
    }
  });

  it("lists exactly the expected secret values in configFromEnv secrets", () => {
    const { secrets } = configFromEnv(nostrChannel, ALL_ENV, PREFIX);
    expect([...secrets].sort()).toEqual([KEY].sort());
  });
});

describe("nostrChannel conversions", () => {
  it("accepts a relays array and a number", () => {
    expect(
      nostrChannel.create({ secretKey: KEY, relays: ["wss://r.example"], ignoreBefore: 5 }),
    ).toBeInstanceOf(NostrAdapter);
  });
  it("refuses a non-digit ignoreBefore", () => {
    expect(() =>
      nostrChannel.create({ secretKey: KEY, relays: ["wss://r.example"], ignoreBefore: "soon" }),
    ).toThrow(/ignoreBefore/);
  });
  it("reports a bad key and a bad relay as invalid_config", () => {
    expect(() => nostrChannel.create({ secretKey: "nope", relays: ["wss://r.example"] })).toThrow(
      /secretKey/,
    );
    expect(() => nostrChannel.create({ secretKey: KEY, relays: ["http://r.example"] })).toThrow(
      /relays/,
    );
    expect(() => nostrChannel.create({ secretKey: KEY, relays: "" })).toThrow(/relays/);
  });
});

describe("nostrChannel null and programmatic fields", () => {
  const base = { secretKey: KEY, relays: ["wss://r.example"] };
  for (const key of ["ignoreBefore", "socketFactory", "client"]) {
    it(`refuses an explicit null ${key}`, () => {
      expect(() => nostrChannel.create({ ...base, [key]: null })).toThrow(new RegExp(key));
    });
  }
  it("refuses a client without the relay methods", () => {
    expect(() => nostrChannel.create({ ...base, client: {} })).toThrow(/client/);
  });
  it("passes client to the adapter", () => {
    const client = { open: () => {}, subscribe: () => {}, publish: () => {}, close: () => {} };
    const adapter = nostrChannel.create({ ...base, client });
    expect((adapter as unknown as { client: unknown }).client).toBe(client);
  });
});
