import type { ReconnectPolicy } from "./gateway-runner.js";

/**
 * Options for {@link ReconnectBackoff}. Delay fields default as documented on `ReconnectPolicy`.
 *
 * @public
 */
export interface ReconnectBackoffOptions extends ReconnectPolicy {
  /** A connection open at least this long resets the delay. Default 60_000. */
  readonly stableAfterMs?: number;
  /** Clock in ms; defaults to `Date.now`. */
  readonly now?: () => number;
}

function checkNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0, got ${value}`);
  }
}

/**
 * Reconnect delay for an adapter that holds a long-lived connection: `min(initialDelayMs *
 * factor^(n-1), maxDelayMs)` for attempt n, reset after a connection that stayed open for
 * `stableAfterMs`.
 *
 * @public
 */
export class ReconnectBackoff {
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly factor: number;
  private readonly maxAttempts: number | undefined;
  private readonly stableAfterMs: number;
  private readonly now: () => number;
  private attempts = 0;
  private openedAt: number | undefined;

  constructor(options: ReconnectBackoffOptions = {}) {
    this.initialDelayMs = options.initialDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 60_000;
    this.factor = options.factor ?? 2;
    this.maxAttempts = options.maxAttempts;
    this.stableAfterMs = options.stableAfterMs ?? 60_000;
    this.now = options.now ?? Date.now;
    checkNonNegativeFinite("initialDelayMs", this.initialDelayMs);
    checkNonNegativeFinite("maxDelayMs", this.maxDelayMs);
    if (!(this.factor >= 1) || !Number.isFinite(this.factor)) {
      throw new RangeError(`factor must be a finite number >= 1, got ${this.factor}`);
    }
  }

  /** Call when the connection opens. */
  opened(): void {
    this.openedAt = this.now();
  }

  /** Delay before the next attempt; `undefined` once `maxAttempts` is spent. Resets first if the last connection was stable. */
  nextDelayMs(): number | undefined {
    if (this.openedAt !== undefined) {
      if (this.now() - this.openedAt >= this.stableAfterMs) this.attempts = 0;
      this.openedAt = undefined;
    }
    if (this.maxAttempts !== undefined && this.attempts >= this.maxAttempts) return undefined;
    const delay = Math.min(this.initialDelayMs * this.factor ** this.attempts, this.maxDelayMs);
    this.attempts += 1;
    return delay;
  }

  /** Back to the initial delay. */
  reset(): void {
    this.attempts = 0;
    this.openedAt = undefined;
  }
}
