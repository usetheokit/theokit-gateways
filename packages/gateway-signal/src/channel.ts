/**
 * `signalChannel` — the Signal channel described as data, with an environment variable bound to
 * each option so `configFromEnv` can read it.
 *
 * Typed locally on purpose, like `telegramChannel`: the object is structurally a
 * `ChannelDescriptor` and the integration package's typecheck catches drift. `create` validates
 * every value before the constructor runs and starts no process (signal-cli starts in `connect()`).
 */

import { SignalAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";
import type { SignalAdapterOptions } from "./types.js";

function invalid(key: string, expected: string): ConfigurationError {
  return new ConfigurationError({
    code: "invalid_config",
    message: `gateway-signal: config.${key} must be ${expected}`,
    detail: key,
  });
}

type Config = Readonly<Record<string, unknown>>;

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
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
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  throw invalid(key, "a number or a string of digits");
}

const E164 = /^\+[1-9]\d{6,14}$/;

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
    key: "account",
    required: true,
    secret: false,
    env: "SIGNAL_ACCOUNT",
    description: "The Signal account (E.164 phone number) registered or linked to signal-cli.",
  },
  {
    key: "signalCliPath",
    required: false,
    secret: false,
    env: "SIGNAL_CLI_PATH",
    description: "Path or name of the signal-cli binary; default `signal-cli` on PATH.",
  },
  {
    key: "configDir",
    required: false,
    secret: false,
    env: "SIGNAL_CONFIG_DIR",
    description: "signal-cli's data directory; default is signal-cli's own.",
  },
  {
    key: "connectTimeoutMs",
    required: false,
    secret: false,
    env: "SIGNAL_CONNECT_TIMEOUT_MS",
    description: "Milliseconds `connect()` waits for signal-cli; default 10000.",
  },
  {
    key: "requestTimeoutMs",
    required: false,
    secret: false,
    env: "SIGNAL_REQUEST_TIMEOUT_MS",
    description: "Milliseconds a send may stay unanswered; default 30000.",
  },
  {
    key: "senderKey",
    required: false,
    secret: false,
    env: "SIGNAL_SENDER_KEY",
    description: 'Which envelope field becomes sender.id: "uuid" (default) or "number".',
  },
];

function buildOptions(config: Config): SignalAdapterOptions {
  const account = readString(config, "account");
  if (account === undefined) throw invalid("account", "a string");
  if (!E164.test(account))
    throw invalid("account", 'a phone number in E.164 form (e.g. "+5511999990000")');
  const signalCliPath = readString(config, "signalCliPath");
  const configDir = readString(config, "configDir");
  const connectTimeoutMs = readNumber(config, "connectTimeoutMs");
  const requestTimeoutMs = readNumber(config, "requestTimeoutMs");
  const senderKey = readString(config, "senderKey");
  if (senderKey !== undefined && senderKey !== "uuid" && senderKey !== "number") {
    throw invalid("senderKey", '"uuid" or "number"');
  }
  return {
    account,
    ...(signalCliPath === undefined ? {} : { signalCliPath }),
    ...(configDir === undefined ? {} : { configDir }),
    ...(connectTimeoutMs === undefined ? {} : { connectTimeoutMs }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    ...(senderKey === undefined ? {} : { senderKey }),
  };
}

/**
 * The Signal channel: signal-cli runs as a child process, so it needs no webhook route.
 *
 * @public
 */
export const signalChannel = {
  platform: "signal" as const,
  transport: "socket" as const,
  senderIdentity: "authenticated" as const,
  config: CONFIG,
  create(config: Config): SignalAdapter {
    return new SignalAdapter(buildOptions(config));
  },
};
