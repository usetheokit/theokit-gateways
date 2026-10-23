/**
 * A bounded set of ids, oldest evicted first, so a long-running process remembers what it delivered
 * without growing for ever (NFR-003).
 */

const DEFAULT_LIMIT = 1_000;

/**
 * The ids an adapter has already delivered, at most `limit` of them.
 */
export class SeenIds {
  private readonly ids = new Set<string>();

  /** @param limit the most ids held at once; the oldest is forgotten when one more arrives */
  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /**
   * Record `id`.
   *
   * @returns `true` when the id was new, `false` when it was already held
   */
  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.limit) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }

  /** Whether `id` is held. */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** How many ids are held. */
  get size(): number {
    return this.ids.size;
  }
}
