/**
 * Matrix alias resolution + caching (D419).
 *
 * Accepts:
 * - Room id (`!abc123:server`) — pass-through.
 * - Alias (`#general:server`) — resolved via `client.getRoomIdForAlias`.
 *
 * Other shapes throw `ConfigurationError({ code: "invalid_room_ref" })`.
 */

import { ConfigurationError } from "./errors.js";

/** @knipignore — minimal Client interface `AliasCache.resolve` accepts; useful for callers building their own resolver. */
export interface AliasResolverClient {
  getRoomIdForAlias(alias: string): Promise<{ room_id: string }>;
}

/**
 * Resolves a Matrix room alias (`#room:server`) to its room id, remembering the answer.
 *
 * An alias resolves through a server round-trip, and the mapping effectively never changes, so
 * repeating it once per outbound message is pure latency. A value that is already a room id is
 * returned untouched, which lets callers pass either form.
 */
export class AliasCache {
  private readonly cache = new Map<string, string>();

  /** Returns the room id; resolves aliases via the client + caches. */
  async resolve(client: AliasResolverClient, refOrId: string): Promise<string> {
    if (refOrId.startsWith("!")) return refOrId;
    if (!refOrId.startsWith("#")) {
      throw new ConfigurationError({
        code: "invalid_room_ref",
        message: `gateway-matrix: invalid room reference ${JSON.stringify(refOrId)} — expected '!' (room id) or '#' (alias)`,
      });
    }
    const cached = this.cache.get(refOrId);
    if (cached !== undefined) return cached;
    const { room_id } = await client.getRoomIdForAlias(refOrId);
    this.cache.set(refOrId, room_id);
    return room_id;
  }

  /** Drop all cached resolutions. Useful for tests + admin-rename recovery. */
  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
