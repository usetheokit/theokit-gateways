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
import { type ConfigField, field } from "../../../shared/channel-config-field.js";
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

const CONFIG: ReadonlyArray<ConfigField> = [
  field("host", "IRC_HOST", "The IRC server's host name, for example irc.libera.chat."),
  field("nick", "IRC_NICK", "The nick the adapter registers with."),
  field(
    "channels",
    "IRC_CHANNELS",
    "Channels to join, #name or &name: an array or a comma-separated string.",
  ),
  field("port", "IRC_PORT", "The server's port; default 6697.", { required: false }),
  field("tls", "IRC_TLS", "Whether to speak TLS; default true.", { required: false }),
  field("username", "IRC_USERNAME", "The username sent in USER; default the nick.", {
    required: false,
  }),
  field("realname", "IRC_REALNAME", "The real name sent in USER; default the nick.", {
    required: false,
  }),
  field("password", "IRC_PASSWORD", "The server password, sent as PASS before registration.", {
    required: false,
    secret: true,
  }),
  field("saslAccount", "IRC_SASL_ACCOUNT", "The account name for SASL PLAIN; default the nick.", {
    required: false,
  }),
  field(
    "saslPassword",
    "IRC_SASL_PASSWORD",
    "The NickServ account password, sent through SASL PLAIN.",
    { required: false, secret: true },
  ),
  field(
    "connectTimeoutMs",
    "IRC_CONNECT_TIMEOUT_MS",
    "How long connect() waits for registration and every join; default 10000.",
    { required: false },
  ),
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
