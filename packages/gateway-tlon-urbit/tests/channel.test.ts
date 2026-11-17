import { configFromEnv, createChannels } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { TlonUrbitAdapter } from "../src/adapter.js";
import { tlonUrbitChannel } from "../src/channel.js";
import { ConfigurationError } from "../src/errors.js";

const ENV: Record<string, string> = {
  TLON_URBIT_SHIP_URL: "https://bot.example.com",
  TLON_URBIT_SHIP: "~sampel-palnet",
  TLON_URBIT_CODE: "lidlut-tabwed-pillex-ridrup",
};

const descriptor = tlonUrbitChannel as unknown as Parameters<typeof configFromEnv>[0];
const secretKeys = tlonUrbitChannel.config.filter((f) => f.secret).map((f) => f.key);

function built(env: Record<string, string | undefined>) {
  const read = configFromEnv(descriptor, env, "APP_");
  const result = createChannels([{ descriptor: descriptor as never, config: read.config }]);
  return { read, result };
}

function withPrefix(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => ["APP_" + k, v]));
}

describe("tlonUrbitChannel", () => {
  it("declares socket transport and no webhook part", () => {
    expect(tlonUrbitChannel.transport).toBe("socket");
    expect("webhook" in tlonUrbitChannel).toBe(false);
  });

  it("builds the adapter through createChannels from configFromEnv", () => {
    const { read, result } = built(withPrefix(ENV));
    expect(read.missing).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(TlonUrbitAdapter);
  });

  const required = tlonUrbitChannel.config.filter((f) => f.required);
  it.each(required.map((f) => f.env))(
    "rejects with missing_required_config when %s is unset",
    (name) => {
      const env = withPrefix(ENV);
      delete env["APP_" + name];
      const { read, result } = built(env);
      expect(read.missing).toEqual(["APP_" + name]);
      const key = required.find((f) => f.env === name)?.key as string;
      expect(result.rejected[0]?.error.code).toBe("missing_required_config");
      expect(result.rejected[0]?.error.message).toContain(key);
    },
  );

  it("collects exactly the secret values", () => {
    const env = withPrefix(ENV);
    const read = configFromEnv(descriptor, env, "APP_");
    const expected = required.filter((f) => f.secret).map((f) => ENV[f.env]);
    expect([...read.secrets].sort()).toEqual([...expected].sort());
    expect(secretKeys.length).toBeGreaterThan(0);
  });

  it("throws invalid_config naming the key for a wrongly typed value", () => {
    for (const field of required) {
      const config = {
        ...configFromEnv(descriptor, withPrefix(ENV), "APP_").config,
        [field.key]: 42,
      };
      try {
        tlonUrbitChannel.create(config);
        throw new Error("expected a throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        expect((err as ConfigurationError).code).toBe("invalid_config");
        expect((err as ConfigurationError).message).toContain(field.key);
      }
    }
  });
});

describe("tlonUrbitChannel connectTimeoutMs", () => {
  const base = { shipUrl: "https://s.example", ship: "~zod", code: "a-b-c-d" };
  it("accepts a number or a digit string", () => {
    expect(tlonUrbitChannel.create({ ...base, connectTimeoutMs: 500 })).toBeInstanceOf(
      TlonUrbitAdapter,
    );
    expect(tlonUrbitChannel.create({ ...base, connectTimeoutMs: "500" })).toBeInstanceOf(
      TlonUrbitAdapter,
    );
  });
  it("rejects anything else", () => {
    expect(() => tlonUrbitChannel.create({ ...base, connectTimeoutMs: "soon" })).toThrow(
      /connectTimeoutMs/,
    );
  });
});
