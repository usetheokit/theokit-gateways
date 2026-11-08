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
 * which fits in a part moves back to the start of that row (B-556). The rule is core
 * `splitKeepingRows`, shared with gateway-line. The `(i/N) ` prefix (and its reserved width) stays here since it is SMS-specific.
 *
 * @internal
 */

import { chunkByGrapheme, splitKeepingRows } from "@theokit/gateway";

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
