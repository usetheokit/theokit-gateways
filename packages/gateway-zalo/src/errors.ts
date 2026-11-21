import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

/** Configuration error of `@theokit/gateway-zalo`. */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: GatewayConfigurationErrorOptions) {
    super("gateway-zalo", opts);
  }
}
