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

/** The unit `partLimit` is measured in. */
export interface SplitKeepingRowsOptions {
  /** How `partLimit` is measured. Default "utf16" (UTF-16 units). */
  readonly unit?: "utf16" | "codepoint";
}

/** The offset reached by moving `count` units on from `from`, or `text.length` when the text ends first. */
function advance(text: string, from: number, count: number, codepoint: boolean): number {
  if (!codepoint) return Math.min(from + count, text.length);
  let at = from;
  for (let left = count; left > 0 && at < text.length; left -= 1) {
    at += (text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1;
  }
  return at;
}

/**
 * The cut to use instead of `cut`: the start of the table row `cut` falls inside, when that row
 * starts after `partStart` and fits in `partLimit` without its line ending; `cut` otherwise. A row
 * that opens the part, or is longer than a part, is cut by length as before (FR-007).
 */
function rowSafeCut(
  text: string,
  partStart: number,
  cut: number,
  partLimit: number,
  codepoint: boolean,
): number {
  const lineStart = lineStartBefore(text, cut, partStart);
  if (lineStart <= partStart || lineStart === cut) return cut;
  if (isLineEnd(text[cut]) || !startsTableRow(text, lineStart)) return cut;
  const bound = advance(text, lineStart, partLimit, codepoint);
  return lineEndFrom(text, cut, bound) <= bound ? lineStart : cut;
}

/**
 * The last grapheme boundary at or below `limitCut`. When one grapheme starting at `start` is
 * longer than the part, its end: the oversized part `chunkByGrapheme` emits (ADR D3).
 */
function graphemeCut(segments: Intl.Segments, start: number, limitCut: number): number {
  const segment = segments.containing(limitCut);
  if (segment === undefined || segment.index >= limitCut) return limitCut;
  return segment.index > start ? segment.index : segment.index + segment.segment.length;
}

/** The requested unit as a code-point flag; throws `RangeError` for a bad unit or limit. */
function readUnit(partLimit: number, options: SplitKeepingRowsOptions): boolean {
  const unit: unknown = options.unit ?? "utf16";
  if (unit !== "utf16" && unit !== "codepoint") {
    throw new RangeError(
      `splitKeepingRows: unit must be "utf16" or "codepoint", got ${String(unit)}`,
    );
  }
  if (unit === "codepoint" && !(Number.isInteger(partLimit) && partLimit > 0)) {
    throw new RangeError(
      `splitKeepingRows: partLimit must be a positive integer, got ${partLimit}`,
    );
  }
  return unit === "codepoint";
}

/**
 * Parts of at most `partLimit` units (UTF-16 units, or code points with `unit: "codepoint"`), cut
 * at grapheme boundaries and before straddled rows. Shared by the SMS and LINE splitters (text no
 * longer than a part is theirs to handle). In code-point mode `partLimit` must be a positive
 * integer and a single grapheme longer than it throws `RangeError`.
 */
export function splitKeepingRows(
  text: string,
  partLimit: number,
  options: SplitKeepingRowsOptions = {},
): string[] {
  const codepoint = readUnit(partLimit, options);
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  const parts: string[] = [];
  let start = 0;
  let limitCut = advance(text, start, partLimit, codepoint);
  while (limitCut < text.length) {
    const grapheme = graphemeCut(segments, start, limitCut);
    if (codepoint && grapheme > limitCut) {
      throw new RangeError(
        `splitKeepingRows: a grapheme at offset ${start} is longer than ${partLimit} code points`,
      );
    }
    const cut = rowSafeCut(text, start, grapheme, partLimit, codepoint);
    /* c8 ignore next 3 -- unreachable: both cuts land after `start` (graphemeCut, rowSafeCut). */
    if (cut <= start) {
      throw new RangeError(`splitKeepingRows: no progress at offset ${start} of ${text.length}`);
    }
    parts.push(text.slice(start, cut));
    start = cut;
    limitCut = advance(text, start, partLimit, codepoint);
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}
