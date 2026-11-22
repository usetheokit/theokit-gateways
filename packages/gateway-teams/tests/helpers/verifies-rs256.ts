/** Whether `rawToken`'s RS256 signature verifies under `publicKey`, through the core helper. */

import type { KeyObject } from "node:crypto";

import { verifyRs256Jwt } from "@theokit/gateway";

export async function verifiesRs256(rawToken: string, publicKey: KeyObject): Promise<boolean> {
  const result = await verifyRs256Jwt(rawToken, { lookup: async () => publicKey });
  return result.ok;
}
