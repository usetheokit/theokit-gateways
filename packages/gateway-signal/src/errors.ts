/** Typed errors for `@theokit/gateway-signal`. */

import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

/** Misconfiguration of this adapter, raised from the constructor before signal-cli starts. */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: GatewayConfigurationErrorOptions) {
    super("gateway-signal", opts);
  }
}
