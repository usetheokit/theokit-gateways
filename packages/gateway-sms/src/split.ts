/**
 * `splitForSMS` — grapheme-cluster-safe multipart segmentation (D393, EC-7), keeping table rows
 * whole.
 *
 * Concatenated SMS (UDH) on modern carriers reassemble at the recipient,
 * but each TCP/IP-layer chunk is one billed message. We segment at
 * 1600 chars (default) so the API call doesn't reject and each part is
 * prefixed with `(i/N) ` to allow manual reordering when carriers
 * deliver out of sequence (EC-7).
 *
 * A text within the limit goes through core `chunkByGrapheme` as before. A longer one is cut at
 * the last grapheme boundary within each part, which is where `chunkByGrapheme`'s greedy walk
 * ends a part, so emoji (🇧🇷) and combining sequences are never severed and text with no table
 * row splits exactly as it did (pinned by `tests/split-no-table-baseline.test.ts` and the
 * equivalence test in `tests/split-tables.test.ts`). A cut that falls inside a Markdown table row
 * which fits in a part moves back to the start of that row (B-556). The rule is private to this
 * package, not a core option, because SMS peers `@theokit/gateway` at `>=0.9.0 <1.0.0` (plan ADR
 * D2). The `(i/N) ` prefix (and its reserved width) stays here since it is SMS-specific.
 *
 * @internal
 */

import { chunkByGrapheme } from "@theokit/gateway";

/**
 * Width of `"(i/total) "` when `i` has as many digits as `total` — the widest
 * the prefix can get for a given part count. `(99/99) ` is 8, `(100/126) ` is
 * 10, `(1000/1234) ` is 12.
 *
 * This used to be the constant 8, commented `"(99/99) " worst case`. It is the
 * worst case only below 100 parts; from the hundredth part on, every prefix
 * overflowed its reservation and each part exceeded the caller's declared cap
 * by 2 chars, which the provider rejects.
 */
function prefixWidthFor(total: number): number {
  return 2 * String(total).length + 4;
}

/** A blank that may precede a row's leading pipe: whitespace other than a line ending. */
const ROW_BLANK = /^[^\S\r\n]$/;

/** `\n`, or `\r` alone or before `\n`: GFM reads a lone CR as a line ending too. */
function isLineEnd(character: string | undefined): boolean {
  return character === "\n" || character === "\r";
}

/**
 * True when the line starting at `from` is a table row: optional blanks, then a pipe. The same
 * definition lives in core `ROW_START` (packages/gateway/src/text/dialect.ts) and in the gateway-line and gateway-nextcloud-talk
 * splitters; a change to one belongs in all four (plan ADR D2).
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

/** Parts of at most `partLimit` units, cut at grapheme boundaries and before straddled rows. */
function splitKeepingRows(text: string, partLimit: number): string[] {
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  const parts: string[] = [];
  let start = 0;
  while (text.length - start > partLimit) {
    const cut = rowSafeCut(text, start, graphemeCut(segments, start, partLimit), partLimit);
    /* c8 ignore next 3 -- unreachable: both cuts land after `start` (graphemeCut, rowSafeCut). */
    if (cut <= start) {
      throw new RangeError(`splitForSMS: no progress at offset ${start} of ${text.length}`);
    }
    parts.push(text.slice(start, cut));
    start = cut;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

/** One fixed-point pass: the parts of `text` with `partLimit` left beside the prefix. */
function partsFor(text: string, limit: number, partLimit: number): string[] {
  if (text.length <= limit) return chunkByGrapheme(text, { limit, partLimit });
  // The core's RangeError for a limit of 0, 1.5 or NaN, with the message it had before.
  chunkByGrapheme("", { limit, partLimit });
  return splitKeepingRows(text, partLimit);
}

export function splitForSMS(text: string, limit = 1600): string[] {
  // Chicken and egg: the reservation depends on the part count, and the part
  // count depends on the reservation. Widening the prefix shrinks the payload,
  // which can push the count into another digit — so iterate to a fixed point.
  // It converges fast because the width grows with the LOGARITHM of the count;
  // the bound is a backstop against a pathological input, not the expected path.
  let reserved = prefixWidthFor(1);
  for (let pass = 0; pass < 8; pass += 1) {
    const partLimit = limit - reserved;
    if (partLimit <= 0) {
      throw new RangeError(
        `limit ${limit} is too small to carry an SMS part: the "(i/N) " prefix alone needs ${reserved} chars`,
      );
    }
    const parts = partsFor(text, limit, partLimit);
    if (parts.length <= 1) return parts; // short-circuit / single part: skip prefix
    const needed = prefixWidthFor(parts.length);
    if (needed <= reserved) {
      const total = parts.length;
      return parts.map((p, i) => `(${i + 1}/${total}) ${p}`);
    }
    reserved = needed;
  }
  /* c8 ignore next 3 -- unreachable: 8 passes cover part counts up to 10^8. */
  throw new RangeError(
    `could not settle the "(i/N) " prefix width for a ${text.length}-char message at limit ${limit}`,
  );
}
