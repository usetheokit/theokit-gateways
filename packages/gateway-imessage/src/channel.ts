/**
 * `imessageChannel` — the iMessage channel described as data, with an environment variable bound
 * to each option so `configFromEnv` can read it.
 *
 * Typed locally on purpose, like `telegramChannel`. `create` validates every value before the
 * constructor runs and starts no process (`imsg` starts in `connect()`).
 */

import {
  type ChannelConfigField,
  channelConfigReaders,
  GatewayConfigurationError,
} from "@theokit/gateway";

import { IMessageAdapter } from "./adapter.js";
import type { IMessageAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

const { invalid, isAbsent, readString } = channelConfigReaders("gateway-imessage");

/** A number or digit string; a digit string past ~308 digits is Infinity and is rejected. */
function readNumber(config: Config, key: string): number | undefined {
  const raw = config[key];
  if (isAbsent(raw)) return undefined;
  const value = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw invalid(key, "a number or a string of digits");
}

const CONFIG: ReadonlyArray<ChannelConfigField> = [
  {
    key: "cliPath",
    required: false,
    secret: false,
    env: "IMESSAGE_CLI_PATH",
    description: "Path or name of the `imsg` binary; default `imsg` on PATH.",
  },
  {
    key: "dbPath",
    required: false,
    secret: false,
    env: "IMESSAGE_DB_PATH",
    description: "Messages database to read; default is `imsg`'s own.",
  },
  {
    key: "connectTimeoutMs",
    required: false,
    secret: false,
    env: "IMESSAGE_CONNECT_TIMEOUT_MS",
    description: "Milliseconds `connect()` waits for `imsg`; default 10000.",
  },
  {
    key: "requestTimeoutMs",
    required: false,
    secret: false,
    env: "IMESSAGE_REQUEST_TIMEOUT_MS",
    description: "Milliseconds a send may stay unanswered; default 30000.",
  },
];

/**
 * The iMessage channel: `imsg` runs as a child process, so it needs no webhook route.
 *
 * `create` throws `invalid_config` when `process.platform` is not `darwin`, so the channel is
 * rejected instead of looping on a missing `imsg`. Build `IMessageAdapter` directly to drive a
 * Mac over an ssh wrapper script from another system.
 *
 * @public
 */
export const imessageChannel = {
  platform: "imessage" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): IMessageAdapter {
    if (process.platform !== "darwin") {
      throw new GatewayConfigurationError("gateway-imessage", {
        code: "invalid_config",
        message: `gateway-imessage: iMessage needs macOS (darwin); this platform is ${process.platform}`,
        detail: "platform",
      });
    }
    const cliPath = readString(config, "cliPath");
    const dbPath = readString(config, "dbPath");
    const connectTimeoutMs = readNumber(config, "connectTimeoutMs");
    const requestTimeoutMs = readNumber(config, "requestTimeoutMs");
    const options: IMessageAdapterOptions = {
      ...(cliPath === undefined ? {} : { cliPath }),
      ...(dbPath === undefined ? {} : { dbPath }),
      ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    };
    return new IMessageAdapter(options);
  },
};
