/**
 * Config and request readers for a webhook channel descriptor whose package keeps a peer floor
 * below the release that ships `channelConfigReaders`. The bundler inlines this file into each
 * package, so it adds no import of `@theokit/gateway` and moves no floor. `invalid` is the channel's
 * own error builder, so each package still throws its own `ConfigurationError`.
 */
type Config = Readonly<Record<string, unknown>>;
type Invalid = (key: string) => Error;

function requiredString(invalid: Invalid, config: Config, key: string): string {
  const value = config[key];
  if (typeof value !== "string") throw invalid(key);
  return value;
}

function optionalString(invalid: Invalid, config: Config, key: string): string | undefined {
  const value = config[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalid(key);
  return value;
}

/** Readers that throw `invalid(key)` for a value that is not a string. */
export function stringConfigReaders(invalid: Invalid) {
  return {
    requiredString: (config: Config, key: string) => requiredString(invalid, config, key),
    /** `{ [key]: value }` when the optional string is present, `{}` when it is absent. */
    optionalEntry: (config: Config, key: string): Record<string, string> => {
      const value = optionalString(invalid, config, key);
      return value === undefined ? {} : { [key]: value };
    },
  };
}

/** The value of header `name` (lower case), whatever case the request used. */
export function headerValue(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

/** What `webhook.ingest` reports for the status an adapter's `ingestWebhook` answered. */
export function ingestOutcome(status: number): "delivered" | "malformed" | "no_handler" {
  if (status === 503) return "no_handler";
  return status === 200 ? "delivered" : "malformed";
}
