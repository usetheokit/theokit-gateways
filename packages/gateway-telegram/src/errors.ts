/**
 * Typed errors for `@theokit/gateway-telegram`.
 *
 * `ConfigurationError` extends the shared core `GatewayConfigurationError`, as every gateway
 * package's does, so `createChannels` reports a refused Telegram config as a rejected channel
 * rather than rethrowing it as a defect.
 */

import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

/**
 * Misconfiguration of the Telegram channel, raised before any network call.
 *
 * Carries a structured `code` the caller can branch on and, for a refused field, the field's key
 * in `detail`. A missing or malformed token is a programmer error, not a transient failure, so it
 * is never retried.
 */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: GatewayConfigurationErrorOptions) {
    super("gateway-telegram", opts);
  }
}
