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
}

type Env = Readonly<Record<string, string | undefined>>;

/** The trimmed value of `name`, or undefined when it is unset, empty or whitespace. */
function readValue(env: Env, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

/**
 * Read a descriptor's fields from `env`, using `prefix + field.env` as the variable name. Fields
 * without `env` are skipped.
 */
export function configFromEnv(descriptor: ChannelDescriptor, env: Env, prefix = ""): EnvConfig {
  const config: Record<string, string> = {};
  const missing: string[] = [];
  const secrets: string[] = [];
  for (const field of descriptor.config) {
    if (field.env === undefined) continue;
    const name = prefix + field.env;
    const value = readValue(env, name);
    if (value === undefined) {
      if (field.required) missing.push(name);
      continue;
    }
    config[field.key] = value;
    recordSecret(field, value, secrets);
  }
  return { config, missing, secrets };
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
