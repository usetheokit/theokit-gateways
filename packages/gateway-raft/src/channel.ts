/**
 * `raftChannel` — the Raft channel described as data, with an environment variable bound to each
 * option so `configFromEnv` can read it.
 *
 * Typed locally on purpose, like `telegramChannel`. `create` validates every value before the
 * constructor runs and starts no process (the CLI starts in `connect()`). The function-valued
 * options `replyArgs` and `spawn` are not configurable from the environment.
 */

import { channelConfigReaders, type ChannelConfigField } from "@theokit/gateway";

import { RaftAdapter } from "./adapter.js";
import type { RaftAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

const { invalid, isAbsent, readString } = channelConfigReaders("gateway-raft");

/** A number or digit string; a digit string past ~308 digits is Infinity and is rejected. */
function readNumber(config: Config, key: string): number | undefined {
  const raw = config[key];
  if (isAbsent(raw)) return undefined;
  const value = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw invalid(key, "a number or a string of digits");
}

/** A list of strings, or a comma-separated string. */
function readList(config: Config, key: string): string[] | undefined {
  const value = config[key];
  if (isAbsent(value)) return undefined;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return [...value];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  throw invalid(key, "an array of strings or a comma-separated string");
}

const CONFIG: ReadonlyArray<ChannelConfigField> = [
  {
    key: "command",
    required: false,
    secret: false,
    env: "RAFT_COMMAND",
    description: "The Raft CLI; default `raft` on PATH.",
  },
  {
    key: "wakeArgs",
    required: false,
    secret: false,
    env: "RAFT_WAKE_ARGS",
    description: "Comma-separated arguments that make the CLI print one JSON wake per line.",
  },
  {
    key: "replyTimeoutMs",
    required: false,
    secret: false,
    env: "RAFT_REPLY_TIMEOUT_MS",
    description: "Milliseconds a reply may take; default 30000.",
  },
];

/**
 * The Raft channel: the Raft CLI runs as a child process, so it needs no webhook route.
 *
 * @public
 */
export const raftChannel = {
  platform: "raft" as const,
  transport: "socket" as const,
  config: CONFIG,
  create(config: Config): RaftAdapter {
    const command = readString(config, "command");
    const wakeArgs = readList(config, "wakeArgs");
    const replyTimeoutMs = readNumber(config, "replyTimeoutMs");
    const options: RaftAdapterOptions = {
      ...(command === undefined ? {} : { command }),
      ...(wakeArgs === undefined ? {} : { wakeArgs }),
      ...(replyTimeoutMs === undefined ? {} : { replyTimeoutMs }),
    };
    return new RaftAdapter(options);
  },
};
