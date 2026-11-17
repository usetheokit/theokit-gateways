/**
 * `raftChannel` — the Raft channel described as data, bound to environment variables.
 */

import { configFromEnv, createChannels, GatewayConfigurationError } from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RaftAdapter } from "../src/adapter.js";
import { raftChannel } from "../src/channel.js";

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
  APP_RAFT_COMMAND: "/opt/raft",
  APP_RAFT_WAKE_ARGS: "wake, --json",
  APP_RAFT_REPLY_TIMEOUT_MS: "5000",
};

describe("raftChannel", () => {
  it("declares a socket transport and env names", () => {
    expect(raftChannel.platform).toBe("raft");
    expect(raftChannel.transport).toBe("socket");
    expect(raftChannel.config.map((f) => f.env)).toContain("RAFT_COMMAND");
  });

  it("builds the adapter from configFromEnv", () => {
    const { config, missing } = configFromEnv(raftChannel, ENV, "APP_");
    expect(missing).toEqual([]);
    const result = createChannels([{ descriptor: raftChannel, config }]);
    expect(result.rejected).toEqual([]);
    expect(result.adapters[0]).toBeInstanceOf(RaftAdapter);
  });

  it("has no required variable, so an empty environment builds", () => {
    const { config, missing } = configFromEnv(raftChannel, {}, "APP_");
    expect(missing).toEqual([]);
    expect(createChannels([{ descriptor: raftChannel, config }]).adapters).toHaveLength(1);
  });

  it("collects no secrets: no field is secret", () => {
    expect(raftChannel.config.filter((f) => f.secret)).toEqual([]);
    expect(configFromEnv(raftChannel, ENV, "APP_").secrets).toEqual([]);
  });

  it("rejects wrongly typed values naming the key", () => {
    for (const [key, value] of [
      ["command", 1],
      ["wakeArgs", 5],
      ["replyTimeoutMs", "slow"],
    ] as const) {
      const error = errorOf(() => raftChannel.create({ [key]: value }));
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(key);
    }
  });

  it("rejects a digit string too long to be a finite number", () => {
    const error = errorOf(() => raftChannel.create({ replyTimeoutMs: "9".repeat(400) }));
    expect(error.code).toBe("invalid_config");
    expect(error.message).toContain("replyTimeoutMs");
  });

  it("rejects null for an optional value, naming the key", () => {
    for (const key of ["command", "wakeArgs", "replyTimeoutMs"]) {
      const error = errorOf(() => raftChannel.create({ [key]: null }));
      expect(error.code).toBe("invalid_config");
      expect(error.message).toContain(key);
    }
  });
});
