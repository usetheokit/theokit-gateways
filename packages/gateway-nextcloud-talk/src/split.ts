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

/** A blank that may precede a row's leading pipe: whitespace other than a line ending. */
const ROW_BLANK = /^[^\S\r\n]$/;

/** `\n`, or `\r` alone or before `\n`: GFM reads a lone CR as a line ending too. */
function isLineEnd(codePoint: string | undefined): boolean {
  return codePoint === "\n" || codePoint === "\r";
}

/**
 * True when the line starting at `from` is a table row: optional blanks, then a pipe. The same
 * definition lives in core `ROW_START` (packages/gateway/src/text/dialect.ts) and in the gateway-line and gateway-sms
 * splitters; a change to one belongs in all four (plan ADR D2).
 */
function startsTableRow(codePoints: readonly string[], from: number): boolean {
  let at = from;
  while (at < codePoints.length && ROW_BLANK.test(codePoints[at] ?? "")) at += 1;
  return codePoints[at] === "|";
}

/** Start of the line holding `cut - 1`, or `partStart` when the line starts at or before it. */
function lineStartBefore(codePoints: readonly string[], cut: number, partStart: number): number {
  let at = cut;
  while (at > partStart && !isLineEnd(codePoints[at - 1])) at -= 1;
  return at;
}

/** End of the line holding `cut`, without its line ending, scanning no further than `bound`. */
function lineEndFrom(codePoints: readonly string[], cut: number, bound: number): number {
  let at = cut;
  while (at < codePoints.length && at <= bound && !isLineEnd(codePoints[at])) at += 1;
  return at;
}

/**
 * The cut to use instead of `cut`, in code points: the start of the table row `cut` falls inside,
 * when that row starts after `partStart` and fits in `limit` code points without its line ending;
 * `cut` otherwise. A row that opens the part, or is longer than a part, is cut by length (FR-007).
 */
function rowSafeCut(
  codePoints: readonly string[],
  partStart: number,
  cut: number,
  limit: number,
): number {
  const lineStart = lineStartBefore(codePoints, cut, partStart);
  if (lineStart <= partStart || lineStart === cut) return cut;
  if (isLineEnd(codePoints[cut]) || !startsTableRow(codePoints, lineStart)) return cut;
  const lineEnd = lineEndFrom(codePoints, cut, lineStart + limit);
  return lineEnd - lineStart <= limit ? lineStart : cut;
}

/**
 * Cut `text` into consecutive parts of at most `limit` code points, never inside a surrogate
 * pair. A Markdown table row that a cut would split, and that fits in a part, starts the next part
 * instead, so it arrives whole (B-556). A text within the limit comes back whole; an empty text
 * gives no part.
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
  let at = 0;
  while (codePoints.length - at > limit) {
    const cut = rowSafeCut(codePoints, at, at + limit, limit);
    /* c8 ignore next 3 -- unreachable: rowSafeCut returns a row start after `at`, or `at + limit`. */
    if (cut <= at) {
      throw new RangeError(`splitForTalk: no progress at code point ${at} of ${codePoints.length}`);
    }
    parts.push(codePoints.slice(at, cut).join(""));
    at = cut;
  }
  if (at < codePoints.length) parts.push(codePoints.slice(at).join(""));
  return parts;
}
