/**
 * The Nextcloud Talk channel described as data.
 *
 * Typed locally on purpose: this package declares `@theokit/gateway` as a peer, and a published
 * `.d.ts` naming a core type a consumer's floor lacks would break that consumer. The object is
 * structurally a `ChannelDescriptor`.
 *
 * `configFromEnv` yields strings, so `create` accepts a list as an array or a comma-separated
 * string, a boolean as a boolean or `"true"`/`"false"`, and a number as a number or a digit string.
 */

import {
  GatewayConfigurationError,
  type GatewayConfigurationErrorOptions,
} from "@theokit/gateway";

import { channelConfigReaders } from "./config-readers.js";
import { NextcloudTalkAdapter } from "./adapter.js";
import type { NextcloudTalkAdapterOptions } from "./types.js";

/** Misconfiguration of the Nextcloud Talk channel, raised before any network call. */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: GatewayConfigurationErrorOptions) {
    super("gateway-nextcloud-talk", opts);
  }
}

type Config = Readonly<Record<string, unknown>>;

const readers = channelConfigReaders(
  "gateway-nextcloud-talk",
  (options) => new ConfigurationError(options),
);
const { invalid, isAbsent, readString, requiredString: readRequiredString } = readers;

/**
 * The shared readers treat `null` and `""` as absent. An explicit `null` is never a valid value,
 * and `""` is not one for a field that is not a string, so both are refused rather than defaulted.
 */
const NON_STRING_KEYS: ReadonlySet<string> = new Set(["port", "connectTimeoutMs", "app", "fetch"]);

function rejectBlank(config: Config): void {
  for (const [key, value] of Object.entries(config)) {
    if (value === null || (value === "" && NON_STRING_KEYS.has(key))) {
      throw invalid(key, "set to a value of its type, not null or empty");
    }
  }
}

function readNumber(config: Config, key: string): number | undefined {
  const value = config[key];
  if (isAbsent(value)) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  throw invalid(key, "a number or a digit string");
}

/** An Express app: a function with the `post` method the adapter mounts its route with. */
function readApp(config: Config): NextcloudTalkAdapterOptions["app"] {
  const app = readers.readFunction(config, "app");
  if (app === undefined) return undefined;
  if (typeof (app as { post?: unknown }).post !== "function") {
    throw invalid("app", "an Express app (a function with a post method)");
  }
  return app as unknown as NextcloudTalkAdapterOptions["app"];
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
    key: "baseUrl",
    required: true,
    secret: false,
    env: "NEXTCLOUD_TALK_BASE_URL",
    description: "The Nextcloud server, https://cloud.example.com, without a trailing path.",
  },
  {
    key: "secret",
    required: true,
    secret: true,
    env: "NEXTCLOUD_TALK_SECRET",
    description: "The bot secret passed to occ talk:bot:install; 40 to 128 characters.",
  },
  {
    key: "port",
    required: false,
    secret: false,
    env: "NEXTCLOUD_TALK_PORT",
    description: "Port the webhook listener binds; default 3000.",
  },
  {
    key: "path",
    required: false,
    secret: false,
    env: "NEXTCLOUD_TALK_PATH",
    description: "Path of the webhook route; default /nextcloud-talk.",
  },
  {
    key: "connectTimeoutMs",
    required: false,
    secret: false,
    env: "NEXTCLOUD_TALK_CONNECT_TIMEOUT_MS",
    description: "How long connect() waits for the capabilities read; default 10000.",
  },
  {
    key: "app",
    required: false,
    secret: false,
    description: "Programmatic only, no env binding: an Express app to mount the webhook route on.",
  },
  {
    key: "fetch",
    required: false,
    secret: false,
    description: "Programmatic only, no env binding: the fetch function used for requests.",
  },
];

/**
 * The Nextcloud Talk channel: the adapter starts its own webhook listener in `connect()`, so the
 * transport is `"socket"`. `create` validates each value and makes no network call; `app` and `fetch`
 * are programmatic fields with no env binding.
 *
 * @public
 */
export const nextcloudTalkChannel = {
  platform: "nextcloud_talk" as const,
  transport: "socket" as const,
  config: CONFIG,
  create(config: Config): NextcloudTalkAdapter {
    rejectBlank(config);
    const options: NextcloudTalkAdapterOptions = defined({
      baseUrl: readRequiredString(config, "baseUrl"),
      secret: readRequiredString(config, "secret"),
      port: readNumber(config, "port"),
      path: readString(config, "path"),
      connectTimeoutMs: readNumber(config, "connectTimeoutMs"),
      app: readApp(config),
      fetch: readers.readFunction(config, "fetch") as NextcloudTalkAdapterOptions["fetch"],
    });
    try {
      return new NextcloudTalkAdapter(options);
    } catch (err) {
      // The constructor throws a plain Error for a secret outside 40 to 128 characters.
      throw new ConfigurationError({
        code: "invalid_config",
        message: `gateway-nextcloud-talk: ${err instanceof Error ? err.message : "invalid config"}`,
        detail: "secret",
      });
    }
  },
};
