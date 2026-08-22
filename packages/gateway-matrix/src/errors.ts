/**
 * Typed errors for `@theokit/gateway-matrix`.
 *
 * `ConfigurationError` extends the shared core `GatewayConfigurationError`
 * base (roadmap M2). Behavior byte-identical (pinned by `tests/errors.test.ts`).
 */

import { GatewayConfigurationError, type GatewayConfigurationErrorOptions } from "@theokit/gateway";

/** @knipignore — public input shape for `ConfigurationError` constructor (caller-extensible). */
export type ConfigurationErrorOptions = GatewayConfigurationErrorOptions;

/**
 * Misconfiguration of this adapter, raised before any network call.
 *
 * Extends the shared core base so every gateway package reports configuration faults in one shape:
 * a structured `code` the caller can branch on, tagged with `"gateway-matrix"` as the origin. A
 * missing credential or an unsupported option is a programmer error, not a transient failure —
 * these are never retried.
 */
export class ConfigurationError extends GatewayConfigurationError {
  override readonly name = "ConfigurationError";
  constructor(opts: ConfigurationErrorOptions) {
    super("gateway-matrix", opts);
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
  constructor() {
    super({
      code: "sdk_not_installed",
      message:
        'gateway-matrix: peer-dep "matrix-js-sdk" not installed. Run: pnpm add matrix-js-sdk',
      detail: "matrix-js-sdk",
    });
  }
}

/**
 * The room is end-to-end encrypted, which this adapter cannot read.
 *
 * E2EE is deferred to v0.2. Raised rather than silently ignoring the room, because a bot that
 * appears connected and never sees a message is far harder to diagnose than one that says why.
 */
export class EncryptedRoomError extends ConfigurationError {
  constructor(roomId: string) {
    super({
      code: "encrypted_room_unsupported",
      message: `gateway-matrix: room ${roomId} is end-to-end encrypted (E2EE deferred to v0.2)`,
      detail: roomId,
    });
  }
}
