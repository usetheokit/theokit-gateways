/**
 * Cutting a reply to Talk's message limit.
 *
 * @public
 */

/**
 * The longest message Talk accepts, in code points. Measured on spreed 21.1.11 (Q6 probe,
 * 2026-10-21): 32000 characters answered 201, 32001 answered 413, and the server's capabilities
 * report `config.chat.max-length` 32000.
 *
 * @public
 */
export const TALK_MAX_LENGTH = 32_000;

/**
 * Cut `text` into consecutive parts of at most `limit` code points, never inside a surrogate
 * pair. A text within the limit comes back whole; an empty text gives no part.
 *
 * @throws RangeError when `limit` is not a positive integer
 * @public
 */
export function splitForTalk(text: string, limit = TALK_MAX_LENGTH): string[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`splitForTalk: limit must be a positive integer, got ${limit}`);
  }
  const codePoints = Array.from(text);
  const parts: string[] = [];
  for (let at = 0; at < codePoints.length; at += limit) {
    parts.push(codePoints.slice(at, at + limit).join(""));
  }
  return parts;
}
