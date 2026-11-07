/**
 * `chunkText` — transport-agnostic, boundary-preferring text chunker.
 *
 * Single-sources the message-splitting knowledge that was copy-pasted across
 * the platform adapters (roadmap M0/M1). It reproduces, byte-for-byte, the two
 * boundary-search families that existed in the adapters:
 *
 *  - **Slack family** (Slack/WhatsApp/Teams): fixed window (`safeLimit = limit`),
 *    boundary preference `"\n\n" → "\n" → " "`, UTF-16 surrogate-pair guard,
 *    leading-whitespace strip on continuation, optional part-trim.
 *  - **Telegram family** (Telegram/Discord): soft window (`safeLimit < limit`),
 *    boundary preference `"\n\n" → "\n"` (no space), no surrogate guard,
 *    leading-newline strip on continuation.
 *
 * The grapheme family (LINE/SMS, `Intl.Segmenter`) is a genuinely different
 * algorithm and is intentionally NOT folded in here — those adapters keep their
 * grapheme walk. Telegram's markdown-pair balancing likewise stays adapter-local.
 *
 * @public
 */

/** Options for {@link chunkText}. */
export interface ChunkTextOptions {
  /**
   * Hard cap. If the whole input is `<= limit`, it is returned as a single
   * chunk (subject to `trimParts`). Continuation chunks are cut within the
   * `safeLimit` window.
   */
  readonly limit: number;
  /**
   * Soft window each cut searches within. Defaults to `limit`. The Telegram
   * family uses a `safeLimit` strictly below `limit` (e.g. 1900 < 2000).
   */
  readonly safeLimit?: number;
  /**
   * Boundary strings tried, in order, from most to least preferred. A boundary
   * is accepted once its position is `>= window * 0.5`; otherwise the next one
   * is tried. Default: `["\n\n", "\n", " "]`.
   */
  readonly boundaries?: readonly string[];
  /**
   * When no boundary reaches the half-window threshold:
   *  - `"last-boundary"` — use the last computed boundary if it is `> 0`,
   *    else fall back to the window edge (Slack family).
   *  - `"window"` — fall back straight to the window edge (Telegram family).
   * Default: `"window"`.
   */
  readonly lastResort?: "last-boundary" | "window";
  /**
   * Guard against slicing through a UTF-16 low surrogate (splitting an emoji).
   * Default: `false`.
   */
  readonly surrogateGuard?: boolean;
  /**
   * Pattern stripped from the START of each continuation chunk. Default `/^\n+/`
   * (Telegram family). Slack family uses `/^\s+/`.
   */
  readonly stripLeading?: RegExp;
  /**
   * When true, each resulting part is `.trim()`-ed and empty parts are dropped
   * (WhatsApp/Teams). Also applied to the single-chunk fast path. Default `false`.
   */
  readonly trimParts?: boolean;
  /**
   * When true, a cut that would fall inside a Markdown table row (a line whose first non-blank
   * character is `|`) moves back to the start of that row, provided the row fits in the window and
   * does not open the chunk; the row then opens the next chunk whole and byte-identical (B-556).
   * A row longer than the window is cut by length as before. Text with no table row splits exactly
   * as without the option. Default: `false`.
   */
  readonly keepTableRows?: boolean;
}

/** Most-preferred boundary at `>= window*0.5`, else the last boundary tried. */
function searchBoundary(remaining: string, window: number, boundaries: readonly string[]): number {
  let cut = window;
  for (const b of boundaries) {
    cut = remaining.lastIndexOf(b, window);
    if (cut >= window * 0.5) return cut;
  }
  return cut;
}

/** Fail fast on a non-positive / non-integer size argument. */
function assertPositiveInt(label: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, received ${value}`);
  }
}

/** Step back one code unit if `cut` would sever a UTF-16 surrogate pair. */
function guardSurrogate(text: string, cut: number): number {
  if (cut >= text.length) return cut;
  const code = text.charCodeAt(cut);
  return code >= 0xdc00 && code <= 0xdfff ? cut - 1 : cut;
}

function findCut(
  remaining: string,
  window: number,
  boundaries: readonly string[],
  lastResort: "last-boundary" | "window",
  surrogateGuard: boolean,
): number {
  let cut = searchBoundary(remaining, window, boundaries);
  if (cut < window * 0.5) {
    cut = lastResort === "last-boundary" && cut > 0 ? cut : window;
  }
  if (surrogateGuard) cut = guardSurrogate(remaining, cut);
  return cut <= 0 ? window : cut;
}

/** `\n`, or `\r` alone or before `\n`: GFM reads a lone CR as a line ending too. */
const isLineEnd = (ch: string | undefined): boolean => ch === "\n" || ch === "\r";

/** True when the line starting at `from` is a table row: optional blanks, then a pipe. */
function startsTableRow(text: string, from: number): boolean {
  let at = from;
  while (at < text.length && /^[^\S\r\n]$/.test(text[at] ?? "")) at += 1;
  return text[at] === "|";
}

/**
 * Where to cut instead of `cut` so a table row it falls inside stays whole: `start` is the row's
 * first character (the next chunk begins there), `end` is where this chunk ends, its trailing line
 * endings dropped. Undefined when `cut` is not inside a row, the row opens the chunk, or the row
 * does not fit in `window`.
 */
function rowSafeCut(
  text: string,
  cut: number,
  window: number,
): { readonly end: number; readonly start: number } | undefined {
  const start = tableRowStart(text, cut);
  if (start === undefined || rowLength(text, start, cut, window) > window) return undefined;
  let end = start;
  while (end > 0 && isLineEnd(text[end - 1])) end -= 1;
  return end > 0 ? { end, start } : undefined;
}

/** Start of the table row `cut` falls inside, or undefined (not in a row, or the row opens the text). */
function tableRowStart(text: string, cut: number): number | undefined {
  if (cut >= text.length || isLineEnd(text[cut])) return undefined;
  let start = cut;
  while (start > 0 && !isLineEnd(text[start - 1])) start -= 1;
  return start > 0 && startsTableRow(text, start) ? start : undefined;
}

/** Length of the row from `start`, scanning no further than `window` past it. */
function rowLength(text: string, start: number, cut: number, window: number): number {
  let rowEnd = cut;
  while (rowEnd < text.length && rowEnd - start <= window && !isLineEnd(text[rowEnd])) rowEnd += 1;
  return rowEnd - start;
}

/**
 * Split `text` into chunks no longer than the configured window, preferring
 * natural boundaries. Behavior is fully determined by {@link ChunkTextOptions}.
 */
export function chunkText(text: string, options: ChunkTextOptions): string[] {
  const {
    limit,
    safeLimit = limit,
    boundaries = ["\n\n", "\n", " "],
    lastResort = "window",
    surrogateGuard = false,
    stripLeading = /^\n+/,
    trimParts = false,
    keepTableRows = false,
  } = options;

  // Fail fast at the boundary: a non-positive `limit` would make `findCut`
  // return 0 forever and hang the loop; `safeLimit > limit` would break the
  // "hard cap" contract by emitting an oversized tail chunk.
  assertPositiveInt("chunkText: limit", limit);
  assertPositiveInt("chunkText: safeLimit", safeLimit);
  if (safeLimit > limit) {
    throw new RangeError(`chunkText: safeLimit (${safeLimit}) must be <= limit (${limit})`);
  }

  const finalize = (parts: string[]): string[] =>
    trimParts ? parts.map((p) => p.trim()).filter((p) => p.length > 0) : parts;

  if (text.length <= limit) {
    return finalize([text]);
  }

  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > safeLimit) {
    const cut = findCut(remaining, safeLimit, boundaries, lastResort, surrogateGuard);
    const moved = keepTableRows ? rowSafeCut(remaining, cut, safeLimit) : undefined;
    if (moved !== undefined) {
      parts.push(remaining.slice(0, moved.end));
      remaining = remaining.slice(moved.start);
      continue;
    }
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(stripLeading, "");
  }
  if (remaining.length > 0) parts.push(remaining);
  return finalize(parts);
}

/** Options for {@link chunkByGrapheme}. */
export interface ChunkByGraphemeOptions {
  /** If `text.length <= limit`, it is returned as a single chunk. */
  readonly limit: number;
  /**
   * Max length per emitted part during the grapheme walk. Defaults to `limit`.
   * Callers that reserve room for a per-part prefix (e.g. SMS `"(i/N) "`) pass a
   * `partLimit` below `limit`.
   */
  readonly partLimit?: number;
}

/**
 * Grapheme-cluster-safe chunker (`Intl.Segmenter`). Never severs an emoji,
 * regional-indicator pair, or combining sequence. Distinct algorithm from
 * {@link chunkText} — used by adapters that must respect grapheme boundaries
 * (LINE, SMS) rather than search for whitespace boundaries.
 *
 * @public
 */
export function chunkByGrapheme(text: string, options: ChunkByGraphemeOptions): string[] {
  const { limit, partLimit = limit } = options;
  assertPositiveInt("chunkByGrapheme: limit", limit);
  assertPositiveInt("chunkByGrapheme: partLimit", partLimit);
  if (text.length === 0) return [""];
  if (text.length <= limit) return [text];

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const parts: string[] = [];
  let buf = "";
  for (const { segment } of segmenter.segment(text)) {
    if (buf.length + segment.length > partLimit) {
      if (buf.length > 0) parts.push(buf);
      buf = "";
    }
    buf += segment;
  }
  if (buf.length > 0) parts.push(buf);
  return parts;
}
