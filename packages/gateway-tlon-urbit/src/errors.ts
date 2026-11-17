import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

/**
 * The ship refused the login code.
 *
 * @public
 */
export class TlonAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TlonAuthError";
  }
}

/**
 * Misconfiguration of this adapter, raised before any network call.
 *
 * @public
 */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: GatewayConfigurationErrorOptions) {
    super("gateway-tlon-urbit", opts);
  }
}
