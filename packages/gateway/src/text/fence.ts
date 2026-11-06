/**
 * Fenced code regions (CommonMark § 4.5), found without a markdown parser.
 *
 * Shared by `rewriteMarkers` (which must not touch a fence) and the chunkers (which must close and
 * reopen one at a cut). A fence opens on a line of up to three spaces, then three or more backticks
 * or tildes (a backtick fence's info string holds no backtick), and closes on a later line of the
 * same character, at least as long, followed only by blanks. One left open runs to the end of the
 * text. Fences nested in a list or block quote are not recognised.
 */

/** One fenced region of a text, as offsets into it. */
export interface FenceRegion {
  /** Start of the opening line. */
  readonly start: number;
  /** End of the closing line without its line ending; the text length when never closed. */
  readonly end: number;
  /** The opening line, without its line ending: what a continuation chunk reopens with. */
  readonly openLine: string;
  /** Start of the first line after the opening line. */
  readonly bodyStart: number;
  /** Start of the closing line; `end` when the fence is never closed. */
  readonly closeStart: number;
  /** The fence characters, e.g. "```": what a chunk is closed with. */
  readonly marker: string;
}

const OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** Offset just past the line ending of the line starting at `from` (the text length on the last). */
function nextLine(text: string, from: number): { lineEnd: number; next: number } {
  let at = from;
  while (at < text.length && text[at] !== "\n" && text[at] !== "\r") at += 1;
  let next = at;
  if (text[next] === "\r" && text[next + 1] === "\n") next += 2;
  else if (next < text.length) next += 1;
  return { lineEnd: at, next };
}

function opening(line: string): string | undefined {
  const m = OPEN.exec(line);
  if (m === null) return undefined;
  const marker = m[1] as string;
  return marker.startsWith("`") && (m[2] as string).includes("`") ? undefined : marker;
}

function closes(line: string, marker: string): boolean {
  const m = CLOSE.exec(line);
  const found = m?.[1];
  return found !== undefined && found[0] === marker[0] && found.length >= marker.length;
}

/**
 * Every fenced region of `text`, in order and non-overlapping. Empty when there is none.
 *
 * @public
 */
export function findFences(text: string): FenceRegion[] {
  const regions: FenceRegion[] = [];
  if (!text.includes("```") && !text.includes("~~~")) return regions;
  let at = 0;
  while (at < text.length) {
    const first = nextLine(text, at);
    const openLine = text.slice(at, first.lineEnd);
    const marker = opening(openLine);
    if (marker === undefined) {
      at = first.next;
      continue;
    }
    let cursor = first.next;
    let closeStart = text.length;
    let end = text.length;
    let after = text.length;
    while (cursor < text.length) {
      const line = nextLine(text, cursor);
      if (closes(text.slice(cursor, line.lineEnd), marker)) {
        closeStart = cursor;
        end = line.lineEnd;
        after = line.next;
        break;
      }
      cursor = line.next;
    }
    regions.push({ start: at, end, openLine, bodyStart: first.next, closeStart, marker });
    at = after;
  }
  return regions;
}
