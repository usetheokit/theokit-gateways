/**
 * `GatewayLifecycleError` — a lifecycle method was called from a state that
 * cannot honour it.
 *
 * Distinct from {@link GatewayConfigurationError}, which reports a bad or
 * missing setting at construction time. This one reports a legal call made at
 * an illegal moment: the configuration is fine, the ordering is not.
 *
 * It exists because the alternative is worse than an error. `GatewayRunner`
 * used to accept `start()` after `stop()` and quietly produce a runner that
 * reconnected its adapters and then refused to disconnect them — a leak that
 * reported success. Failing loudly at the call that cannot be honoured is the
 * only outcome a caller can act on.
 *
 * @public
 */

/** Public input shape for the {@link GatewayLifecycleError} constructor. */
export interface GatewayLifecycleErrorOptions {
  /** Stable, machine-readable discriminator (e.g. `"runner_stopped"`). */
  readonly code: string;
  /** Human-readable explanation, including what the caller should do instead. */
  readonly message: string;
}

/**
 * Thrown when a lifecycle transition is not available from the current state.
 *
 * @public
 */
export class GatewayLifecycleError extends Error {
  override readonly name: string = "GatewayLifecycleError";
  /** Stable discriminator, so callers branch on `code` rather than on message text. */
  readonly code: string;

  constructor(opts: GatewayLifecycleErrorOptions) {
    super(opts.message);
    this.code = opts.code;
  }
}
