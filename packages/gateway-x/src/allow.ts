/**
 * Who may be answered: the allowlist, and guest mode with a per-author daily cap.
 */

import type { XGuestOptions } from "./types.js";

function handle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

/** Allowlist plus guest-mode accounting. */
export class XAccessPolicy {
  private readonly allowed: ReadonlySet<string>;
  private readonly guestLimit: number | undefined;
  private day = "";
  private readonly used = new Map<string, number>();

  constructor(allowFrom: readonly string[], guest: XGuestOptions | undefined) {
    this.allowed = new Set(allowFrom.map(handle).filter((v) => v !== ""));
    this.guestLimit = guest === undefined ? undefined : Math.max(0, Math.floor(guest.dailyLimit));
  }

  /**
   * Decide one mention: `"allowed"`, `"guest"` (and count it) or `"refused"`.
   * `nowMs` picks the UTC day the guest counter belongs to.
   */
  decide(authorId: string, username: string, nowMs: number): "allowed" | "guest" | "refused" {
    if (this.allowed.has(authorId) || (username !== "" && this.allowed.has(handle(username)))) {
      return "allowed";
    }
    if (this.guestLimit === undefined) return "refused";
    const day = new Date(nowMs).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used.clear();
    }
    const count = this.used.get(authorId) ?? 0;
    if (count >= this.guestLimit) return "refused";
    this.used.set(authorId, count + 1);
    return "guest";
  }
}
