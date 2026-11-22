/**
 * The callback token check, in constant time.
 */

import { safeEqualString } from "@theokit/gateway";

/**
 * Whether `received` equals `expected`, compared in constant time by the core `safeEqualString`.
 * An empty token never matches. An empty `expected` never reaches here: the adapter refuses it at
 * construction.
 */
export function tokensMatch(expected: string, received: string): boolean {
  return safeEqualString(expected, received);
}
