/**
 * Grapheme-safe splitting of long text that keeps Markdown table rows whole (B-556).
 *
 * @internal
 */

/** A blank that may precede a row's leading pipe: whitespace other than a line ending. */
const ROW_BLANK = /^[^\S\r\n]$/;

/** `\n`, or `\r` alone or before `\n`: GFM reads a lone CR as a line ending too. */
function isLineEnd(character: string | undefined): boolean {
  return character === "\n" || character === "\r";
}

/**
 * True when the line starting at `from` is a table row: optional blanks, then a pipe. The same
 * definition lives in core `ROW_START` (packages/gateway/src/text/dialect.ts) and in the
 * gateway-nextcloud-talk splitter.
 */
function startsTableRow(text: string, from: number): boolean {
  let at = from;
  while (at < text.length && ROW_BLANK.test(text[at] ?? "")) at += 1;
  return text[at] === "|";
}

/** Start of the line holding `cut - 1`, or `partStart` when the line starts at or before it. */
function lineStartBefore(text: string, cut: number, partStart: number): number {
  let at = cut;
  while (at > partStart && !isLineEnd(text[at - 1])) at -= 1;
  return at;
}

/** End of the line holding `cut`, without its line ending, scanning no further than `bound`. */
function lineEndFrom(text: string, cut: number, bound: number): number {
  let at = cut;
  while (at < text.length && at <= bound && !isLineEnd(text[at])) at += 1;
  return at;
}

/**
 * The cut to use instead of `cut`: the start of the table row `cut` falls inside, when that row
 * starts after `partStart` and fits in `partLimit` without its line ending; `cut` otherwise. A row
 * that opens the part, or is longer than a part, is cut by length as before (FR-007).
 */
function rowSafeCut(text: string, partStart: number, cut: number, partLimit: number): number {
  const lineStart = lineStartBefore(text, cut, partStart);
  if (lineStart <= partStart || lineStart === cut) return cut;
  if (isLineEnd(text[cut]) || !startsTableRow(text, lineStart)) return cut;
  const lineEnd = lineEndFrom(text, cut, lineStart + partLimit);
  return lineEnd - lineStart <= partLimit ? lineStart : cut;
}

/**
 * The last grapheme boundary at or below `start + partLimit`. When one grapheme starting at
 * `start` is longer than the part, its end: the oversized part `chunkByGrapheme` emits (ADR D3).
 */
function graphemeCut(segments: Intl.Segments, start: number, partLimit: number): number {
  const cut = start + partLimit;
  const segment = segments.containing(cut);
  if (segment === undefined || segment.index >= cut) return cut;
  return segment.index > start ? segment.index : segment.index + segment.segment.length;
}

/**
 * Parts of at most `partLimit` units, cut at grapheme boundaries and before straddled rows.
 * Shared by the SMS and LINE splitters (text no longer than a part is theirs to handle).
 */
export function splitKeepingRows(text: string, partLimit: number): string[] {
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  const parts: string[] = [];
  let start = 0;
  while (text.length - start > partLimit) {
    const cut = rowSafeCut(text, start, graphemeCut(segments, start, partLimit), partLimit);
    /* c8 ignore next 3 -- unreachable: both cuts land after `start` (graphemeCut, rowSafeCut). */
    if (cut <= start) {
      throw new RangeError(`splitKeepingRows: no progress at offset ${start} of ${text.length}`);
    }
    parts.push(text.slice(start, cut));
    start = cut;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}
