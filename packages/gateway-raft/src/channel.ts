/**
 * `raftChannel` — the Raft channel described as data, with an environment variable bound to each
 * option so `configFromEnv` can read it.
 *
 * Typed locally on purpose, like `telegramChannel`. `create` validates every value before the
 * constructor runs and starts no process (the CLI starts in `connect()`). The function-valued
 * options `replyArgs` and `spawn` are not configurable from the environment.
 */

import { GatewayConfigurationError } from "@theokit/gateway";

import { RaftAdapter } from "./adapter.js";
import type { RaftAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

function invalid(key: string, expected: string): GatewayConfigurationError {
  return new GatewayConfigurationError("gateway-raft", {
    code: "invalid_config",
    message: `gateway-raft: config.${key} must be ${expected}`,
    detail: key,
  });
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === "";
}

function readString(config: Config, key: string): string | undefined {
  const value = config[key];
  if (isAbsent(value)) return undefined;
  if (typeof value !== "string") throw invalid(key, "a string");
  return value;
}

/** A number, or a string of digits (what `configFromEnv` yields). */
function readNumber(config: Config, key: string): number | undefined {
  const value = config[key];
  if (isAbsent(value)) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    // A digit string longer than ~308 digits converts to Infinity, which a timer treats as 1 ms.
    if (Number.isFinite(parsed)) return parsed;
  }
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

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly description: string;
  readonly env: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
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
