/**
 * Typed errors for `@theokit/gateway-sms` (D389-D396).
 *
 * - `ConfigurationError` — programmer error at construction time
 *   (missing signing secret, missing backend SDK install, malformed
 *   phone number on outbound). Thrown synchronously.
 * - `BackendNotInstalledError` — peer-dep optional backend (twilio /
 *   plivo / @vonage/server-sdk) was selected but the npm package is
 *   not installed. Carries actionable install hint.
 *
 * `ConfigurationError` extends the shared core `GatewayConfigurationError`
 * base (roadmap M2); the SDK still consumes structured errors via
 * `metadata.code`. Behavior byte-identical (pinned by `tests/errors.test.ts`).
 *
 * @internal — re-exported by `src/index.ts`.
 */

import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

/** @knipignore — public input shape for `ConfigurationError` constructor (caller-extensible). */
export type ConfigurationErrorOptions = GatewayConfigurationErrorOptions;

/**
 * Misconfiguration of this adapter, raised before any network call.
 *
 * Extends the shared core base so every gateway package reports configuration faults in one shape:
 * a structured `code` the caller can branch on, tagged with `"gateway-sms"` as the origin. A
 * missing credential or an unsupported option is a programmer error, not a transient failure —
 * these are never retried.
 */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: ConfigurationErrorOptions) {
    super("gateway-sms", opts);
  }
}

/**
 * The provider SDK for the selected backend is not installed.
 *
 * `gateway-sms` speaks to Twilio, Plivo or Vonage, and declares all three as optional peers — a
 * project installs only the one it uses. Selecting a backend whose SDK is absent is caught here, at
 * connect time, with the package name and the command that installs it.
 */
export class BackendNotInstalledError extends ConfigurationError {
  constructor(backend: "twilio" | "plivo" | "vonage", pkgName: string) {
    super({
      code: "backend_not_installed",
      message: `gateway-sms: peer-dep "${pkgName}" not installed but backend="${backend}" was selected. Run: pnpm add ${pkgName}`,
      detail: pkgName,
    });
  }
}
