/**
 * The callback token check, in constant time.
 */

import crypto from "node:crypto";

/**
 * Whether `received` equals `expected`, compared with `timingSafeEqual` so the time taken says
 * nothing about how much of it matched. Tokens of different lengths are refused without comparing.
 * An empty `expected` never reaches here: the adapter refuses it at construction.
 */
export function tokensMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
