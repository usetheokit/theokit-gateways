/** Typed errors for `@theokit/gateway-feishu-lark`. */

import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

/** Misconfiguration of the channel, raised before any network call. */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: GatewayConfigurationErrorOptions) {
    super("gateway-feishu-lark", opts);
  }
}
