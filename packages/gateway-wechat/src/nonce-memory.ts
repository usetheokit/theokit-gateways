/**
 * The nonces of recently accepted webhook requests, each tied to the body it arrived with.
 *
 * A plain-mode signature does not cover the body. Each accepted `timestamp + nonce` is kept with a
 * digest of its body, and the same pair arriving with a different body is refused. The digest is
 * what lets the platform's own retry of the same request (same query, same body, for instance
 * after a 503) through to the message-id dedupe instead of being refused.
 */

import crypto from "node:crypto";

import { WECHAT_TOLERANCE_S } from "./signature.js";

/**
 * Long enough that any timestamp still inside the tolerance when recorded has gone stale by the
 * time its entry is forgotten (a timestamp up to `WECHAT_TOLERANCE_S` ahead of now stays fresh for
 * twice the tolerance).
 */
const RETAIN_MS = 2 * WECHAT_TOLERANCE_S * 1000;
/** Hard ceiling, oldest forgotten first, so a burst cannot grow the map without bound. */
const DEFAULT_LIMIT = 10_000;

const digest = (body: string): string =>
  crypto.createHash("sha256").update(body, "utf8").digest("hex");

export class NonceMemory {
  /** Insertion order is expiry order, because every entry is retained for the same span. */
  private readonly entries = new Map<string, { bodyDigest: string; forgetAt: number }>();

  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /**
   * Record a signed request.
   *
   * @returns `false` when the same timestamp and nonce were already accepted with another body
   */
  admit(timestamp: string, nonce: string, body: string, nowMs: number = Date.now()): boolean {
    this.forgetExpired(nowMs);
    const key = `${timestamp}\n${nonce}`;
    const bodyDigest = digest(body);
    const known = this.entries.get(key);
    if (known !== undefined) return known.bodyDigest === bodyDigest;
    this.entries.set(key, { bodyDigest, forgetAt: nowMs + RETAIN_MS });
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return true;
  }

  private forgetExpired(nowMs: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.forgetAt > nowMs) return;
      this.entries.delete(key);
    }
  }
}
