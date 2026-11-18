/**
 * Readers that coerce one `ChannelDescriptor.create` config value, accepting the string shapes
 * `configFromEnv` yields. Each package passes its own error factory so refusals keep the package's
 * configuration error class and `gateway-<name>:` prefix.
 */

type Config = Readonly<Record<string, unknown>>;

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value.trim())) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Coercing readers bound to one error factory. */
export interface ConfigReaders {
  string(config: Config, key: string): string;
  optionalString(config: Config, key: string): string | undefined;
  boolean(config: Config, key: string): boolean | undefined;
  number(config: Config, key: string): number | undefined;
  list(config: Config, key: string): string[] | undefined;
}

/**
 * Build the readers. `invalid(key, expected)` returns the error to throw for a refused value.
 *
 * @public
 */
export function createConfigReaders(
  invalid: (key: string, expected: string) => Error,
): ConfigReaders {
  const string = (config: Config, key: string): string => {
    const value = config[key];
    if (typeof value !== "string") throw invalid(key, "a string");
    if (value.trim().length === 0) throw invalid(key, "a non-empty string");
    return value;
  };
  return {
    string,
    optionalString: (config, key) => (config[key] === undefined ? undefined : string(config, key)),
    boolean(config, key) {
      const value = config[key];
      if (value === undefined) return undefined;
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      throw invalid(key, 'a boolean or the string "true" or "false"');
    },
    number(config, key) {
      const value = config[key];
      if (value === undefined) return undefined;
      const parsed = toFiniteNumber(value);
      if (parsed !== undefined) return parsed;
      throw invalid(key, "a number or a digit string");
    },
    list(config, key) {
      const value = config[key];
      if (value === undefined) return undefined;
      if (typeof value === "string") {
        return value
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
      throw invalid(key, "an array of strings or a comma-separated string");
    },
  };
}
