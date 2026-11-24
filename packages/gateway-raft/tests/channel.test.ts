/**
 * `raftChannel` — the Raft channel described as data, bound to environment variables.
 */

import {
  configFromEnv,
  createChannels,
  isAuthenticatedSender,
} from "@theokit/gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RaftAdapter } from "../src/adapter.js";
import { raftChannel } from "../src/channel.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function invalidConfig(key: string) {
  return expect.objectContaining({
    code: "invalid_config",
    message: expect.stringContaining(key),
  });
}

const ENV = {
  APP_RAFT_COMMAND: "/opt/raft",
  APP_RAFT_WAKE_ARGS: "wake, --json",
  APP_RAFT_REPLY_TIMEOUT_MS: "5000",
};

describe("raftChannel", () => {
  it("declares a socket transport and env names, and no authenticated sender", () => {
    expect("senderIdentity" in raftChannel).toBe(false);
    expect(isAuthenticatedSender(raftChannel)).toBe(false);
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
      expect(() => raftChannel.create({ [key]: value })).toThrow(invalidConfig(key));
    }
  });

  it("rejects a digit string too long to be a finite number", () => {
    expect(() => raftChannel.create({ replyTimeoutMs: "9".repeat(400) })).toThrow(
      invalidConfig("replyTimeoutMs"),
    );
  });

  it("treats null as absent for an optional value, like the shared readers", () => {
    for (const key of ["command", "wakeArgs", "replyTimeoutMs"]) {
      expect(() => raftChannel.create({ [key]: null })).not.toThrow();
    }
  });
});
