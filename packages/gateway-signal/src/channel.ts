/**
 * `signalChannel` — the Signal channel described as data, with an environment variable bound to
 * each option so `configFromEnv` can read it.
 *
 * Typed locally on purpose, like `telegramChannel`: the object is structurally a
 * `ChannelDescriptor` and the integration package's typecheck catches drift. `create` validates
 * every value before the constructor runs and starts no process (signal-cli starts in `connect()`).
 */

import { channelConfigReaders } from "@theokit/gateway";

import { type ConfigField, field } from "../../../shared/channel-config-field.js";
import { SignalAdapter } from "./adapter.js";
import { ConfigurationError } from "./errors.js";
import type { SignalAdapterOptions } from "./types.js";

type Config = Readonly<Record<string, unknown>>;

const readers = channelConfigReaders(
  "gateway-signal",
  (options) => new ConfigurationError(options),
);
const { invalid, isAbsent, readString, requiredString } = readers;

/** A number or digit string; a digit string past ~308 digits is Infinity and is rejected. */
function readNumber(config: Config, key: string): number | undefined {
  const raw = config[key];
  if (isAbsent(raw)) return undefined;
  const value = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw invalid(key, "a number or a string of digits");
}

const E164 = /^\+[1-9]\d{6,14}$/;

const CONFIG: ReadonlyArray<ConfigField> = [
  field(
    "account",
    "SIGNAL_ACCOUNT",
    "The Signal account (E.164 phone number) registered or linked to signal-cli.",
  ),
  field(
    "signalCliPath",
    "SIGNAL_CLI_PATH",
    "Path or name of the signal-cli binary; default `signal-cli` on PATH.",
    { required: false },
  ),
  field(
    "configDir",
    "SIGNAL_CONFIG_DIR",
    "signal-cli's data directory; default is signal-cli's own.",
    { required: false },
  ),
  field(
    "connectTimeoutMs",
    "SIGNAL_CONNECT_TIMEOUT_MS",
    "Milliseconds `connect()` waits for signal-cli; default 10000.",
    { required: false },
  ),
  field(
    "requestTimeoutMs",
    "SIGNAL_REQUEST_TIMEOUT_MS",
    "Milliseconds a send may stay unanswered; default 30000.",
    { required: false },
  ),
  field(
    "senderKey",
    "SIGNAL_SENDER_KEY",
    'Which envelope field becomes sender.id: "uuid" (default) or "number".',
    { required: false },
  ),
];

function buildOptions(config: Config): SignalAdapterOptions {
  const account = requiredString(config, "account");
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
