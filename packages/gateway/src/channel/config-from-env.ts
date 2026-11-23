/**
 * `configFromEnv` and `selectVariant`: bind a channel descriptor's config fields to environment
 * variables, and pick one of a platform's config shapes.
 *
 * @public
 */

import { GatewayConfigurationError } from "../errors/config-error.js";
import type { ChannelConfigField, ChannelDescriptor } from "./channel-descriptor.js";

/** What `configFromEnv` read from the environment. Holds secret values: never log it whole. */
export interface EnvConfig {
  /** Trimmed, non-empty values by config key. */
  readonly config: Readonly<Record<string, string>>;
  /** Full variable names of required fields that are unset, empty or whitespace. */
  readonly missing: readonly string[];
  /** Values of present fields marked secret, for a log mask. Never logged. */
  readonly secrets: readonly string[];
  /** Present only when `enabledBy` was given: whether that variable is `"true"` (any case) or `"1"`. */
  readonly enabled?: boolean;
}

/** Options for `configFromEnv`; a plain string is shorthand for `{ prefix }`. */
export interface EnvOptions {
  /** Prepended to each field's `env`. Default `""`. */
  readonly prefix?: string;
  /** Full variable name by config key, replacing `prefix + field.env` for that field. */
  readonly rename?: Readonly<Record<string, string>>;
  /** Config keys that are required in addition to the fields marked required. */
  readonly require?: readonly string[];
  /** Full name of a flag variable; `enabled` is true when it is `"true"` (any case) or `"1"`. */
  readonly enabledBy?: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** The full environment variable name for a field: `prefix + field.env`, or `undefined` without `env`. */
export function envVarName(field: ChannelConfigField, prefix = ""): string | undefined {
  return field.env === undefined ? undefined : prefix + field.env;
}

/** The trimmed value of `name`, or undefined when it is unset, empty or whitespace. */
function readValue(env: Env, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

/**
 * Read a descriptor's fields from `env`, using `prefix + field.env` (or the `rename` entry for the key) as the variable name. Fields
 * without `env` are skipped.
 */
export function configFromEnv(
  descriptor: ChannelDescriptor,
  env: Env,
  options: string | EnvOptions = "",
): EnvConfig {
  const opts: EnvOptions = typeof options === "string" ? { prefix: options } : options;
  const config: Record<string, string> = {};
  const missing: string[] = [];
  const secrets: string[] = [];
  for (const field of descriptor.config) {
    const name = variableName(field, opts);
    if (name === undefined) continue;
    const value = readValue(env, name);
    if (value === undefined) {
      if (isRequired(field, opts)) missing.push(name);
      continue;
    }
    config[field.key] = value;
    recordSecret(field, value, secrets);
  }
  if (opts.enabledBy === undefined) return { config, missing, secrets };
  return { config, missing, secrets, enabled: isEnabled(env, opts.enabledBy) };
}

function variableName(field: ChannelConfigField, opts: EnvOptions): string | undefined {
  const renamed = opts.rename !== undefined && Object.hasOwn(opts.rename, field.key);
  return renamed ? opts.rename?.[field.key] : envVarName(field, opts.prefix);
}

function isRequired(field: ChannelConfigField, opts: EnvOptions): boolean {
  return field.required || (opts.require?.includes(field.key) ?? false);
}

function isEnabled(env: Env, name: string): boolean {
  const flag = readValue(env, name)?.toLowerCase();
  return flag === "true" || flag === "1";
}

function recordSecret(field: ChannelConfigField, value: string, secrets: string[]): void {
  if (field.secret && !secrets.includes(value)) secrets.push(value);
}

function mismatch(parent: ChannelDescriptor, variant: ChannelDescriptor, name: string): never {
  throw new GatewayConfigurationError("gateway", {
    code: "platform_mismatch",
    message: `channel ${parent.platform}: variant "${name}" reports platform ${variant.platform}`,
  });
}

function unknownVariant(descriptor: ChannelDescriptor, name: string | undefined): never {
  const valid = Object.keys(descriptor.variants ?? {});
  const given = name === undefined ? "(none given)" : `"${name}"`;
  throw new GatewayConfigurationError("gateway", {
    code: "unknown_channel_variant",
    message: `channel ${descriptor.platform}: unknown variant ${given}; valid variants: ${
      valid.length > 0 ? valid.join(", ") : "(none)"
    }`,
  });
}

/**
 * The descriptor to use for `name`: the descriptor itself when `name` is undefined and it has no
 * variants, otherwise the named variant. Throws `unknown_channel_variant` for a name that is not a
 * variant (or a missing name when variants exist) and `platform_mismatch` for a variant whose
 * platform differs from its parent's.
 */
export function selectVariant(
  descriptor: ChannelDescriptor,
  name: string | undefined,
): ChannelDescriptor {
  const variants = descriptor.variants ?? {};
  if (name === undefined && Object.keys(variants).length === 0) return descriptor;
  const variant = name !== undefined && Object.hasOwn(variants, name) ? variants[name] : undefined;
  if (variant === undefined) return unknownVariant(descriptor, name);
  if (variant.platform !== descriptor.platform) mismatch(descriptor, variant, name ?? "");
  return variant;
}
