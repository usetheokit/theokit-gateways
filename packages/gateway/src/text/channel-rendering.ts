/**
 * What `ChatPresenter` needs to know about one platform: how to rewrite the text, and which
 * `format` to declare on the message (B-019 FR-001, FR-002).
 *
 * `toDialect` alone is not enough, and composing it with the presenter's defaults proved it:
 * `ChatPresenter` declares `markdown` unless told otherwise, and `toDialect` passes a platform it
 * was not taught through unchanged. So matrix and email put `**bold**` on the wire as characters
 * (matrix drops `markdown` with a warning, email escapes it into `<pre>`), and telegram and slack
 * were handed a bold spelled for a dialect whose bold is a single asterisk. The text rewrite and
 * the format flag have to be chosen together, per platform, by the package that knows what each
 * adapter does with `format` — this one.
 *
 * Pure data and pure functions: no I/O, and the same input always gives the same output.
 * `@theokit/gateway` still does not depend on `@theokit/presenter`; `ChannelRendering` matches
 * the presenter's `translate` and `format` options structurally.
 */

import type { PlatformName } from "../types/message-event.js";
import { DIALECTS, type Dialect, rewriteMarkers } from "./dialect.js";

/**
 * The pair a consumer spreads into `ChatPresenter`'s options for one platform.
 *
 * @public
 */
export interface ChannelRendering {
  /** The rendering hint the adapter receives as `OutboundMessage.format`. */
  readonly format: "plain" | "markdown";
  /** Rewrites the assembled answer for the platform. Pure and deterministic. */
  readonly translate: (text: string) => string;
}

/**
 * Slack's mrkdwn: emphasis is a single character, `*bold*`, `_italic_`, `~strike~`, and inline
 * code keeps its backtick (https://api.slack.com/reference/surfaces/formatting).
 */
const SLACK: Dialect = { bold: "*", italic: "_", strike: "~", code: "`" };

/** No marker survives; the content they wrapped does. */
const STRIP: Dialect = {};

const identity = (text: string): string => text;

const translateWith =
  (dialect: Dialect) =>
  (text: string): string =>
    rewriteMarkers(text, dialect);

/**
 * One row per platform. A `Record` over `PlatformName`, so a platform added to the union without
 * a row here is a compile error rather than a silent fallback.
 *
 * - whatsapp: inline single-character emphasis in the text, and `plain`, because its adapter
 *   carries no formatting flag on a text message.
 * - slack: the same emphasis, declared `markdown` so the adapter sets `mrkdwn`.
 * - discord, mattermost, teams: markdown is what they render, so the text passes through.
 * - signal: `markdown`, passed through; its adapter turns the markers into Signal's `textStyle`
 *   ranges, so the text it sends carries no marker characters.
 * - line, sms: no rich text at all; the existing `toDialect` rows drop the markers.
 * - imessage: markers dropped and `plain`. `imsg` sends the text as typed, and Messages shows a
 *   marker character as itself.
 * - google_chat: markers dropped and `plain`. Chat's own markup is close to, but not, markdown, and
 *   how it renders a reply is unmeasured until a live run (plan Q3).
 * - telegram: markers dropped and `plain`. Its adapter maps `markdown` to legacy Markdown, which
 *   refuses a reply with an unpaired `_` or `*` and loses it with no retry; losing emphasis is the
 *   cheaper failure (plan ADR D3).
 * - matrix, email: markers dropped and `plain`. Neither renders `markdown` (see the module comment),
 *   and producing HTML would need a markdown renderer this package does not have.
 */
const RENDERINGS: Readonly<Record<PlatformName, ChannelRendering>> = {
  whatsapp: { format: "plain", translate: translateWith(DIALECTS.whatsapp) },
  slack: { format: "markdown", translate: translateWith(SLACK) },
  discord: { format: "markdown", translate: identity },
  mattermost: { format: "markdown", translate: identity },
  teams: { format: "markdown", translate: identity },
  signal: { format: "markdown", translate: identity },
  line: { format: "plain", translate: translateWith(DIALECTS.line) },
  sms: { format: "plain", translate: translateWith(DIALECTS.sms) },
  telegram: { format: "plain", translate: translateWith(STRIP) },
  matrix: { format: "plain", translate: translateWith(STRIP) },
  email: { format: "plain", translate: translateWith(STRIP) },
  imessage: { format: "plain", translate: translateWith(STRIP) },
  google_chat: { format: "plain", translate: translateWith(STRIP) },
};

/**
 * The rendering `ChatPresenter` needs for `platform`.
 *
 * Only the four inline markers `toDialect` knows are rewritten: bold, italic, strikethrough and
 * inline code. Headings, links, lists and block quotes pass through on every platform, and fenced
 * code is not handled yet (the inline-code rule rewrites a fence's backticks).
 *
 * @param platform - the destination, typically `event.platform` of the inbound message
 * @returns the `{ translate, format }` pair for that platform
 * @throws RangeError when `platform` is not one of the platforms this package knows. Answering with
 *   nothing would let the presenter fall back to identity and `markdown`, which is the defect this
 *   function exists to remove.
 * @public
 */
export function channelRendering(platform: PlatformName): ChannelRendering {
  const rendering: ChannelRendering | undefined = Object.hasOwn(RENDERINGS, platform)
    ? RENDERINGS[platform]
    : undefined;
  if (rendering === undefined) {
    throw new RangeError(
      `channelRendering: unknown platform "${String(platform)}"; expected one of ${Object.keys(RENDERINGS).join(", ")}`,
    );
  }
  return rendering;
}
