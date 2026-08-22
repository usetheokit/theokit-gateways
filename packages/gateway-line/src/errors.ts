/**
 * Typed errors for `@theokit/gateway-line`.
 *
 * `ConfigurationError` extends the shared core `GatewayConfigurationError`
 * base (roadmap M2) — only the package prefix is package-specific. Name,
 * message shape, `code`/`detail` fields, and `instanceof` are byte-identical
 * to the previous hand-rolled class (pinned by `tests/errors.test.ts`).
 */

import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

/** @knipignore — public input shape for `ConfigurationError` constructor (caller-extensible). */
export type ConfigurationErrorOptions = GatewayConfigurationErrorOptions;

/**
 * Misconfiguration of this adapter, raised before any network call.
 *
 * Extends the shared core base so every gateway package reports configuration faults in one shape:
 * a structured `code` the caller can branch on, tagged with `"gateway-line"` as the origin. A
 * missing credential or an unsupported option is a programmer error, not a transient failure —
 * these are never retried.
 */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: ConfigurationErrorOptions) {
    super("gateway-line", opts);
  }
}

/**
 * The platform SDK this adapter needs is declared as a peer dependency and is not installed.
 *
 * Raised at connect time rather than at import, so a project that installs several gateway packages
 * only pays for the SDKs of the ones it actually starts. The message names the exact package and
 * the command that installs it.
 */
export class SDKNotInstalledError extends ConfigurationError {
  constructor(pkgName: string) {
    super({
      code: "sdk_not_installed",
      message: `gateway-line: peer-dep "${pkgName}" not installed. Run: pnpm add ${pkgName}`,
      detail: pkgName,
    });
  }
}
