/**
 * `signalChannel` — the Signal channel described as data, bound to environment variables.
 */

import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignalAdapter } from "../src/adapter.js";
import { signalChannel } from "../src/channel.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function errorOf(fn: () => unknown): GatewayConfigurationError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GatewayConfigurationError);
    return err as GatewayConfigurationError;
  }
  throw new Error("expected a configuration error");
}

const ENV = {
  APP_SIGNAL_ACCOUNT: "+5511999990000",
  APP_SIGNAL_CLI_PATH: "/usr/bin/signal-cli",
  APP_SIGNAL_REQUEST_TIMEOUT_MS: "5000",
};

describe("signalChannel", () => {
  it("declares a socket transport and env names", () => {
    expect(signalChannel.platform).toBe("signal");
    expect(signalChannel.transport).toBe("socket");
    expect(signalChannel.config.map((f) => f.env)).toContain("SIGNAL_ACCOUNT");
    expect(signalChannel.config.map((f) => f.env)).toContain("SIGNAL_CLI_PATH");
  });

  it("builds the adapter from configFromEnv", () => {
    const { config, missing } = configFromEnv(signalChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: signalChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(SignalAdapter);
  });

  it("names the full variable through configFromEnv, and createChannels rejects the entry", () => {
    const { config, missing } = configFromEnv(signalChannel, {}, "APP_");
    expect(missing).toEqual(["APP_SIGNAL_ACCOUNT"]);
    // The documented flow reports `missing` and does not build; createChannels itself only
    // knows the key, so a caller that skips the guard is still rejected, naming `account`.
    const result = createChannels([{ descriptor: signalChannel, config }]);
    expect(result.adapters).toEqual([]);
    expect(result.rejected[0]?.error.code).toBe("missing_required_config");
    expect(result.rejected[0]?.error.message).toContain("account");
  });

  it("collects no secrets: no field is secret", () => {
    expect(signalChannel.config.filter((f) => f.secret)).toEqual([]);
    expect(configFromEnv(signalChannel, ENV, "APP_").secrets).toEqual([]);
  });

  it("rejects wrongly typed values naming the key", () => {
    for (const [key, value] of [
      ["account", 42],
      ["signalCliPath", 1],
      ["requestTimeoutMs", "fast"],
      ["senderKey", "email"],
    ] as const) {
      const error = errorOf(() =>
        signalChannel.create({ account: "+5511999990000", [key]: value }),
      );
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(key);
    }
  });

  it("rejects an account that is not E.164", () => {
    const error = errorOf(() => signalChannel.create({ account: "5511" }));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("account");
  });

  it("accepts senderKey and a numeric timeout", () => {
    expect(
      signalChannel.create({
        account: "+5511999990000",
        senderKey: "number",
        connectTimeoutMs: 100,
      }),
    ).toBeInstanceOf(SignalAdapter);
  });

  it("rejects a digit string too long to be a finite number", () => {
    const error = errorOf(() =>
      signalChannel.create({ account: "+5511999990000", requestTimeoutMs: "9".repeat(400) }),
    );
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("requestTimeoutMs");
  });

  it("rejects null for an optional value, naming the key", () => {
    for (const key of ["signalCliPath", "requestTimeoutMs", "senderKey"]) {
      const error = errorOf(() => signalChannel.create({ account: "+5511999990000", [key]: null }));
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(key);
    }
  });
});
