/**
 * Local config readers. `@theokit/gateway@0.21.0` does not export `channelConfigReaders`, so the
 * package keeps its own copy and loads against any core its peer range admits.
 */

import type { GatewayConfigurationError } from "@theokit/gateway";

type Input = Readonly<Record<string, unknown>>;

export function channelConfigReaders(
  prefix: string,
  createError: (options: {
    readonly code: string;
    readonly message: string;
    readonly detail: string;
  }) => GatewayConfigurationError,
) {
  const invalid = (key: string, expected: string): GatewayConfigurationError =>
    createError({
      code: "invalid_config",
      message: `${prefix}: config.${key} must be ${expected}`,
      detail: key,
    });
  const isAbsent = (value: unknown): boolean =>
    value === undefined || value === null || value === "";
  return {
    invalid,
    isAbsent,
    readString(config: Input, key: string): string | undefined {
      const value = config[key];
      if (isAbsent(value)) return undefined;
      if (typeof value !== "string") throw invalid(key, "a string");
      return value;
    },
    requiredString(config: Input, key: string): string {
      const value = config[key];
      if (typeof value !== "string" || value === "") throw invalid(key, "a non-empty string");
      return value;
    },
    readBoolean(config: Input, key: string): boolean | undefined {
      const value = config[key];
      if (isAbsent(value)) return undefined;
      if (typeof value !== "boolean") throw invalid(key, "a boolean");
      return value;
    },
    readFunction<T extends (...args: never[]) => unknown>(
      config: Input,
      key: string,
    ): T | undefined {
      const value = config[key];
      if (isAbsent(value)) return undefined;
      if (typeof value !== "function") throw invalid(key, "a function");
      return value as T;
    },
  };
}
