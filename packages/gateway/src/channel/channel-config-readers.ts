/**
 * `channelConfigReaders` — the config readers every channel's `create` needs, written once.
 *
 * Each channel package used to carry its own copy of `invalid`, `readString`, `requiredString`
 * and friends; only the error prefix differed. The readers throw a configuration error coded
 * `invalid_config` with the message `${prefix}: config.${key} must be ${expected}`.
 *
 * @public
 */

import { GatewayConfigurationError } from "../errors/config-error.js";

/** A channel's config object, as `create` receives it. */
export type ChannelConfigInput = Readonly<Record<string, unknown>>;

/** The readers bound to one package prefix. */
export interface ChannelConfigReaders {
  /** Builds (does not throw) the `invalid_config` error for `key`. */
  invalid(key: string, expected: string): GatewayConfigurationError;
  /** `undefined`, `null` and `""` are absent. */
  isAbsent(value: unknown): boolean;
  /** An optional string; absent gives `undefined`, a non-string throws. */
  readString(config: ChannelConfigInput, key: string): string | undefined;
  /** A required string; absent, empty or a non-string throws. */
  requiredString(config: ChannelConfigInput, key: string): string;
  /** An optional boolean; absent gives `undefined`, a non-boolean throws. */
  readBoolean(config: ChannelConfigInput, key: string): boolean | undefined;
  /**
   * An optional function; absent gives `undefined`, a non-function throws. Only callability is
   * checked: the caller names the signature `T` and is responsible for it.
   */
  readFunction<T extends (...args: never[]) => unknown>(
    config: ChannelConfigInput,
    key: string,
  ): T | undefined;
}

/**
 * Returns the config readers for a package.
 *
 * @param prefix Package prefix in every message, e.g. `"gateway-line"`.
 * @param createError Builds the error to throw; defaults to `GatewayConfigurationError`. Pass a
 *   package's own subclass to keep its `instanceof` contract.
 */
export function channelConfigReaders(
  prefix: string,
  createError: (options: {
    readonly code: string;
    readonly message: string;
    readonly detail: string;
  }) => GatewayConfigurationError = (options) => new GatewayConfigurationError(prefix, options),
): ChannelConfigReaders {
  const invalid = (key: string, expected: string): GatewayConfigurationError =>
    createError({
      code: "invalid_config",
      message: `${prefix}: config.${key} must be ${expected}`,
      detail: key,
    });
  const isAbsent = (value: unknown): boolean =>
    value === undefined || value === null || value === "";
  const readString = (config: ChannelConfigInput, key: string): string | undefined => {
    const value = config[key];
    if (isAbsent(value)) return undefined;
    if (typeof value !== "string") throw invalid(key, "a string");
    return value;
  };
  return {
    invalid,
    isAbsent,
    readString,
    requiredString(config, key) {
      const value = config[key];
      if (typeof value !== "string" || value === "") throw invalid(key, "a non-empty string");
      return value;
    },
    readBoolean(config, key) {
      const value = config[key];
      if (isAbsent(value)) return undefined;
      if (typeof value !== "boolean") throw invalid(key, "a boolean");
      return value;
    },
    readFunction<T extends (...args: never[]) => unknown>(
      config: ChannelConfigInput,
      key: string,
    ): T | undefined {
      const value = config[key];
      if (isAbsent(value)) return undefined;
      if (typeof value !== "function") throw invalid(key, "a function");
      return value as T;
    },
  };
}
