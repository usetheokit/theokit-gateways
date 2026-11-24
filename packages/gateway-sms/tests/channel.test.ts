import { configFromEnv, createChannels, isAuthenticatedSender } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

import { SMSAdapter } from "../src/adapter.js";
import { smsChannel } from "../src/channel.js";
import { ConfigurationError } from "../src/errors.js";

const ENV: Record<string, string> = {
  SMS_ACCOUNT_SID: "ACtest",
  SMS_AUTH_TOKEN: "tok-secret",
  SMS_FROM_NUMBER: "+15550001111",
  SMS_PUBLIC_URL: "https://example.com/sms",
};

const descriptor = smsChannel as unknown as Parameters<typeof configFromEnv>[0];
const secretKeys = smsChannel.config.filter((f) => f.secret).map((f) => f.key);

function built(env: Record<string, string | undefined>) {
  const read = configFromEnv(descriptor, env, "APP_");
  const result = createChannels([
    { descriptor: descriptor as never, config: read.config, envPrefix: "APP_" },
  ]);
  return { read, result };
}

function withPrefix(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => ["APP_" + k, v]));
}

describe("smsChannel", () => {
  it("declares an unauthenticated sender with a reason", () => {
    expect(isAuthenticatedSender(smsChannel)).toBe(false);
    expect(smsChannel.senderIdentity).toEqual({
      unauthenticated: "the caller id of a text message",
    });
  });
  it("declares webhook transport and a POST-only webhook part", () => {
    expect(smsChannel.transport).toBe("webhook");
    expect(smsChannel.webhook.methods).toEqual(["POST"]);
  });

  it("builds the adapter through createChannels from configFromEnv", () => {
    const { read, result } = built(withPrefix(ENV));
    expect(read.missing).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(SMSAdapter);
  });

  const required = smsChannel.config.filter((f) => f.required);
  it.each(required.map((f) => f.env))(
    "rejects with missing_required_config when %s is unset",
    (name) => {
      const env = withPrefix(ENV);
      delete env["APP_" + name];
      const { read, result } = built(env);
      expect(read.missing).toEqual(["APP_" + name]);
      const key = required.find((f) => f.env === name)?.key as string;
      expect(result.rejected[0]?.error.code).toBe("missing_required_config");
      expect(result.rejected[0]?.error.message).toContain(`${key} (env APP_${name})`);
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
        smsChannel.create(config);
        throw new Error("expected a throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigurationError);
        expect((err as ConfigurationError).code).toBe("invalid_config");
        expect((err as ConfigurationError).message).toContain(field.key);
      }
    }
  });
});
