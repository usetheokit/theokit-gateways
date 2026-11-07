/**
 * Fenced code block scanner (B-518).
 *
 * Reads the fences of CommonMark § 4.5: a line of at most three blanks, then three or more
 * backticks or tildes (an info string after a backtick run holds no backtick), closed by a line of
 * the same character, at least as many, and nothing after them but blanks. A fence never closed runs
 * to the end of the text. Fences inside a list item or block quote (indented four or more, or behind
 * a `>`) are not read.
 *
 * @public
 */

/** One fenced code block, as offsets into the scanned text. */
export interface FenceRegion {
  /** Offset of the first character of the opening line. */
  readonly start: number;
  /** Offset just past the opening line, before its line ending. */
  readonly openerEnd: number;
  /** Offset of the first character after the opening line's line ending (the first code line). */
  readonly contentStart: number;
  /** Offset just past the last character of the closing line (its line ending excluded), or the text length when never closed. */
  readonly end: number;
  /** The opening line, byte for byte. */
  readonly opener: string;
  /** The marker run that closes the block: the opening run, without its indent. */
  readonly closer: string;
  /** False when the text ends before a closing line. */
  readonly closed: boolean;
}

/** A cheap test for any line that could open a fence, so text with none costs one regex pass. */
const MAY_FENCE = /^ {0,3}(?:`{3}|~{3})/m;
const OPENING = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSING = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function lineEndAt(text: string, from: number): { end: number; next: number } {
  let end = from;
  while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end += 1;
  let next = end;
  if (text[next] === "\r" && text[next + 1] === "\n") next += 2;
  else if (next < text.length) next += 1;
  return { end, next };
}

/** The closing line of a fence opened with `run`, searched from `from`: where it ends, and where the next line starts. */
function findClose(
  text: string,
  from: number,
  run: string,
): { end: number; next: number } | undefined {
  for (let scan = from; scan < text.length; ) {
    const line = lineEndAt(text, scan);
    const found = CLOSING.exec(text.slice(scan, line.end))?.[1];
    if (found !== undefined && found[0] === run[0] && found.length >= run.length) return line;
    scan = line.next;
  }
  return undefined;
}

/** Every fenced region of `text`, in order. */
export function scanFences(text: string): readonly FenceRegion[] {
  if (!MAY_FENCE.test(text)) return [];
  const regions: FenceRegion[] = [];
  let pos = 0;
  while (pos < text.length) {
    const start = pos;
    const line = lineEndAt(text, start);
    const open = OPENING.exec(text.slice(start, line.end));
    const run = open?.[1];
    if (run === undefined || (run.startsWith("`") && (open?.[2] ?? "").includes("`"))) {
      pos = line.next;
      continue;
    }
    const close = findClose(text, line.next, run);
    pos = close?.next ?? text.length;
    const end = close?.end ?? text.length;
    const closed = close !== undefined;
    regions.push({
      start,
      openerEnd: line.end,
      contentStart: line.next,
      end,
      opener: text.slice(start, line.end),
      closer: run,
      closed,
    });
  }
  return regions;
}

/** The region `offset` falls strictly inside (after its first character, before its end), if any. */
export function fenceAt(regions: readonly FenceRegion[], offset: number): FenceRegion | undefined {
  return regions.find((r) => r.start < offset && offset < r.end);
}

/** The line ending that follows the opening line of `region` in `text` (`\n` when the text ends there). */
export function openerEol(text: string, region: FenceRegion): string {
  if (text.startsWith("\r\n", region.openerEnd)) return "\r\n";
  return text[region.openerEnd] === "\r" ? "\r" : "\n";
}
