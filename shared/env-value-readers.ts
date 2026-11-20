/**
 * Readers for config values that may arrive as environment strings, where only `undefined` is
 * absent: `null` and `""` are wrong shapes and throw. The core readers treat both as absent, so a
 * channel that must refuse them takes these instead. `invalid` is the channel's own error builder.
 */
type Config = Readonly<Record<string, unknown>>;
type Invalid = (key: string, expected: string) => Error;

function readEnvNumber(invalid: Invalid, config: Config, key: string): number | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  throw invalid(key, "a number or a digit string");
}

function readEnvBoolean(invalid: Invalid, config: Config, key: string): boolean | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw invalid(key, 'a boolean or the string "true" or "false"');
}

export function envValueReaders(invalid: Invalid) {
  return {
    number: (config: Config, key: string) => readEnvNumber(invalid, config, key),
    boolean: (config: Config, key: string) => readEnvBoolean(invalid, config, key),
  };
}
