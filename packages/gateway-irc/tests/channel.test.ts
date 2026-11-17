import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { IrcAdapter } from "../src/adapter.js";
import { ConfigurationError, ircChannel } from "../src/channel.js";

const PREFIX = "APP_";
const REQUIRED_ENV: Record<string, string> = {
  APP_IRC_HOST: "irc.example.org",
  APP_IRC_NICK: "theobot",
  APP_IRC_CHANNELS: "#a",
};
const ALL_ENV: Record<string, string> = {
  APP_IRC_HOST: "irc.example.org",
  APP_IRC_NICK: "theobot",
  APP_IRC_CHANNELS: "#a, #b",
  APP_IRC_PORT: "6667",
  APP_IRC_TLS: "false",
  APP_IRC_USERNAME: "bot",
  APP_IRC_REALNAME: "The Bot",
  APP_IRC_PASSWORD: "server-pass",
  APP_IRC_SASL_ACCOUNT: "botacct",
  APP_IRC_SASL_PASSWORD: "sasl-pass",
  APP_IRC_CONNECT_TIMEOUT_MS: "5000",
};

describe("ircChannel", () => {
  it("declares a socket transport and no webhook part", () => {
    expect(ircChannel.transport).toBe("socket");
    expect("webhook" in ircChannel).toBe(false);
  });

  it("builds the adapter from configFromEnv with every required variable set", () => {
    const { config, missing } = configFromEnv(ircChannel, REQUIRED_ENV, PREFIX);
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: ircChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(IrcAdapter);
  });

  it("builds the adapter from every variable, converting strings", () => {
    const { config } = configFromEnv(ircChannel, ALL_ENV, PREFIX);
    expect(ircChannel.create(config)).toBeInstanceOf(IrcAdapter);
  });

  for (const name of Object.keys(REQUIRED_ENV)) {
    it(`rejects with missing_required_config when ${name} is unset`, () => {
      const env = { ...REQUIRED_ENV };
      delete env[name];
      const { config, missing } = configFromEnv(ircChannel, env, PREFIX);
      expect(missing).toEqual([name]);
      const key = ircChannel.config.find((f) => PREFIX + f.env === name)?.key as string;
      const result = createChannels([{ descriptor: ircChannel, config }]);
      expect(result.adapters).toEqual([]);
      expect(result.rejected[0]?.error.code).toBe("missing_required_config");
      expect(result.rejected[0]?.error.message).toContain(key);
    });
  }

  it("throws invalid_config naming the key for a wrongly typed value", () => {
    const config = { ...configFromEnv(ircChannel, REQUIRED_ENV, PREFIX).config, host: 42 };
    try {
      ircChannel.create(config);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      expect(err).toBeInstanceOf(GatewayConfigurationError);
      expect((err as ConfigurationError).code).toBe("invalid_config");
      expect((err as ConfigurationError).message).toContain("host");
    }
  });

  it("lists exactly the secret fields in configFromEnv secrets", () => {
    const { config, secrets } = configFromEnv(ircChannel, ALL_ENV, PREFIX);
    const secretKeys = ircChannel.config.filter((f) => f.secret).map((f) => f.key);
    expect([...secrets].sort()).toEqual(secretKeys.map((k) => config[k] as string).sort());
    expect(secrets).toHaveLength(secretKeys.length);
  });
});

describe("ircChannel conversions", () => {
  const base = { host: "irc.example.org", nick: "theobot" };
  it("accepts a list array, a boolean and a number", () => {
    expect(ircChannel.create({ ...base, channels: ["#a"], tls: false, port: 6667 })).toBeInstanceOf(
      IrcAdapter,
    );
  });
  it("refuses a channels value that is neither an array nor a string", () => {
    expect(() => ircChannel.create({ ...base, channels: 5 })).toThrow(/channels/);
  });
  it("refuses a tls value that is not a boolean", () => {
    expect(() => ircChannel.create({ ...base, channels: ["#a"], tls: "yes" })).toThrow(/tls/);
  });
  it("refuses a non-digit port", () => {
    expect(() => ircChannel.create({ ...base, channels: ["#a"], port: "66x" })).toThrow(/port/);
  });
  it("reports a malformed channel as invalid_config", () => {
    expect(() => ircChannel.create({ ...base, channels: ["nohash"] })).toThrow(ConfigurationError);
  });
});
