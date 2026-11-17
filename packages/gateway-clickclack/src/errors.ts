/** Typed errors for `@theokit/gateway-clickclack`. */

import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

/** Misconfiguration of the channel, raised before any network call. */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: GatewayConfigurationErrorOptions) {
    super("gateway-clickclack", opts);
  }
}
