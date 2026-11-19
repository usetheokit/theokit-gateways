/**
 * The IRC channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type a consumer's floor lacks would break that consumer. The object is
 * structurally a `ChannelDescriptor`.
 *
 * `configFromEnv` yields strings, so `create` accepts a list as an array or a comma-separated
 * string, a boolean as a boolean or `"true"`/`"false"`, and a number as a number or a digit string.
 */

import {
  channelConfigReaders,
  GatewayConfigurationError,
  type GatewayConfigurationErrorOptions,
} from "@theokit/gateway";
import { IrcAdapter } from "./adapter.js";
import type { IrcAdapterOptions } from "./types.js";

/** Misconfiguration of the IRC channel, raised before any network call. */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: GatewayConfigurationErrorOptions) {
    super("gateway-irc", opts);
  }
}

type Config = Readonly<Record<string, unknown>>;

const readers = channelConfigReaders("gateway-irc", (options) => new ConfigurationError(options));
const {
  invalid,
  readString,
  requiredString: readRequiredString,
  readNumber,
  readList,
  readBooleanString,
} = readers;

/**
 * The shared readers treat `null` and `""` as absent. An explicit `null` is never a valid value,
 * and `""` is not one for a field that is not a string, so both are refused rather than defaulted.
 */
const NON_STRING_KEYS: ReadonlySet<string> = new Set([
  "port",
  "tls",
  "connectTimeoutMs",
  "socketFactory",
  "channels",
]);

function rejectBlank(config: Config): void {
  for (const [key, value] of Object.entries(config)) {
    if (value === null || (value === "" && NON_STRING_KEYS.has(key))) {
      throw invalid(key, "set to a value of its type, not null or empty");
    }
  }
}

/** Keep only the keys whose value is defined. */
function defined<T extends object>(options: T): T {
  return Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) as T;
}

/** One configuration field, shaped like the core's `ChannelConfigField` (typed locally). */
interface ConfigField {
  readonly key: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly env?: string;
  readonly description: string;
}

const CONFIG: ReadonlyArray<ConfigField> = [
  {
    key: "host",
    required: true,
    secret: false,
    env: "IRC_HOST",
    description: "The IRC server's host name, for example irc.libera.chat.",
  },
  {
    key: "nick",
    required: true,
    secret: false,
    env: "IRC_NICK",
    description: "The nick the adapter registers with.",
  },
  {
    key: "channels",
    required: true,
    secret: false,
    env: "IRC_CHANNELS",
    description: "Channels to join, #name or &name: an array or a comma-separated string.",
  },
  {
    key: "port",
    required: false,
    secret: false,
    env: "IRC_PORT",
    description: "The server's port; default 6697.",
  },
  {
    key: "tls",
    required: false,
    secret: false,
    env: "IRC_TLS",
    description: "Whether to speak TLS; default true.",
  },
  {
    key: "username",
    required: false,
    secret: false,
    env: "IRC_USERNAME",
    description: "The username sent in USER; default the nick.",
  },
  {
    key: "realname",
    required: false,
    secret: false,
    env: "IRC_REALNAME",
    description: "The real name sent in USER; default the nick.",
  },
  {
    key: "password",
    required: false,
    secret: true,
    env: "IRC_PASSWORD",
    description: "The server password, sent as PASS before registration.",
  },
  {
    key: "saslAccount",
    required: false,
    secret: false,
    env: "IRC_SASL_ACCOUNT",
    description: "The account name for SASL PLAIN; default the nick.",
  },
  {
    key: "saslPassword",
    required: false,
    secret: true,
    env: "IRC_SASL_PASSWORD",
    description: "The NickServ account password, sent through SASL PLAIN.",
  },
  {
    key: "connectTimeoutMs",
    required: false,
    secret: false,
    env: "IRC_CONNECT_TIMEOUT_MS",
    description: "How long connect() waits for registration and every join; default 10000.",
  },
  {
    key: "socketFactory",
    required: false,
    secret: false,
    description:
      "Programmatic only, no env binding: a function that opens the connection, given the endpoint.",
  },
];

/**
 * The IRC channel: the adapter opens its own connection in `connect()`, so it needs no webhook
 * route. `create` validates each value and makes no network call; `socketFactory` is a programmatic field with no env binding.
 *
 * @public
 */
export const ircChannel = {
  platform: "irc" as const,
  transport: "socket" as const,
  config: CONFIG,
  create(config: Config): IrcAdapter {
    rejectBlank(config);
    const channels = readList(config, "channels");
    if (channels === undefined)
      throw invalid("channels", "an array of strings or a comma-separated string");
    const options: IrcAdapterOptions = defined({
      host: readRequiredString(config, "host"),
      nick: readRequiredString(config, "nick"),
      channels,
      port: readNumber(config, "port"),
      tls: readBooleanString(config, "tls"),
      username: readString(config, "username"),
      realname: readString(config, "realname"),
      password: readString(config, "password"),
      saslAccount: readString(config, "saslAccount"),
      saslPassword: readString(config, "saslPassword"),
      connectTimeoutMs: readNumber(config, "connectTimeoutMs"),
      socketFactory: readers.readFunction(
        config,
        "socketFactory",
      ) as IrcAdapterOptions["socketFactory"],
    });
    try {
      return new IrcAdapter(options);
    } catch (err) {
      // The constructor throws a plain Error for a malformed host, nick, channel or credential.
      throw new ConfigurationError({
        code: "invalid_config",
        message: `gateway-irc: ${err instanceof Error ? err.message : "invalid config"}`,
      });
    }
  },
};
