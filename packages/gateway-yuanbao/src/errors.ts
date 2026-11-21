import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

/** Configuration error of `@theokit/gateway-yuanbao`. */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: GatewayConfigurationErrorOptions) {
    super("gateway-yuanbao", opts);
  }
}
