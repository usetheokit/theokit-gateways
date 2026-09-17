/**
 * Markdown → the target channel's own dialect (B-019 FR-005).
 *
 * ## Why this exists here, and not in an adapter
 *
 * Measured 2026-09-17 across every `adapter.ts` and `split.ts` in the ten packages: **no package
 * transforms a single character of text.** What exists is markdown ESCAPE (discord, mattermost),
 * HTML escape (email), phone normalisation (whatsapp) and post-cut newline cleanup (telegram's
 * splitter). `OutboundMessage.format` is read by all ten — `adapter-contract.test.ts` proves it —
 * but reading a flag is not translating a body.
 *
 * So the agent answered `**Bom Sucesso (MG)**` and both LINE and WhatsApp delivered the asterisks
 * to a real phone. The adapters refuse the translation deliberately and they are right to:
 * `gateway-whatsapp` reads `format` only to warn once, because emphasis there is inline in the
 * text rather than a transport flag. An adapter is transport.
 *
 * Translation is PRESENTATION — it depends on what was said and on where it is going at the same
 * time — so it belongs to the presenter. It is exported from here as a pure function and CALLED by
 * the channel presenter in `theokit`, never the reverse: `@theokit/gateway` must not depend on
 * `@theokit/presenter`, or a gateway stops being usable without an agent.
 *
 * ## What it deliberately does NOT do
 *
 * It is not a markdown parser. It rewrites the four inline markers that reach a chat surface in
 * practice — bold, italic, strikethrough, inline code — and it leaves everything else alone:
 * links, headings, lists, block quotes and fenced code are untouched, because no measurement here
 * says what they should become on a platform with no equivalent.
 *
 * A platform it has not been taught is passed through UNCHANGED. Inventing a mapping would be
 * wrong invisibly; passing `**bold**` through is wrong where somebody can see it.
 */

/** A dialect is what each of the four markers becomes. `undefined` means "drop the marker". */
interface Dialect {
  readonly bold?: string;
  readonly italic?: string;
  readonly strike?: string;
  readonly code?: string;
}

/**
 * Per-platform dialects, and the reason each one is what it is.
 *
 * Only platforms whose dialect was actually established appear. The ones absent — telegram,
 * discord, slack, mattermost, matrix, teams, email — either parse markdown natively or take a
 * transport flag their adapter already sets, so rewriting their text would corrupt it.
 */
const DIALECTS: Readonly<Record<string, Dialect>> = {
  // WhatsApp emphasis is inline and single-character: *bold*, _italic_, ~strike~, ```mono```.
  whatsapp: { bold: "*", italic: "_", strike: "~", code: "```" },
  // LINE text messages carry no rich text at all — decoration is emoji-only. Markers are dropped.
  line: {},
  // SMS is plain text by definition of the medium.
  sms: {},
};

/**
 * Every marker in ONE pattern, matched in a single pass.
 *
 * Sequential `replace` calls cannot work here and the failure is silent: rewriting `**a**` to
 * WhatsApp's `*a*` produces text the italic rule then matches, so bold arrives as italic. Caught by
 * the first test written against this file — `**Bom Sucesso (MG)**` came out `_Bom Sucesso (MG)_`.
 *
 * Alternation order is load-bearing: `**` before `*`, `~~` before `~`.
 */
const PATTERN =
  /\*\*(?<bold>.+?)\*\*|~~(?<strike>.+?)~~|(?<![*\w])\*(?!\s)(?<italicStar>.+?)(?<!\s)\*(?!\*)|(?<![_\w])_(?!\s)(?<italicUnderscore>.+?)(?<!\s)_(?!\w)|`(?<code>.+?)`/gu;

/**
 * Rewrite `text` for `platform`.
 *
 * @param text - the assembled answer, in markdown as the model produced it
 * @param platform - the destination; one this function has not been taught passes through
 * @returns the text in the platform's dialect, or unchanged when none is known
 * @public
 */
export function toDialect(text: string, platform: string): string {
  const dialect = DIALECTS[platform];
  if (dialect === undefined) return text;

  return text.replace(PATTERN, (matched, ...args) => {
    const groups = args.at(-1) as Record<string, string | undefined> | undefined;
    if (groups === undefined) return matched;

    const [marker, content] =
      groups.bold !== undefined
        ? (["bold", groups.bold] as const)
        : groups.strike !== undefined
          ? (["strike", groups.strike] as const)
          : groups.italicStar !== undefined
            ? (["italic", groups.italicStar] as const)
            : groups.italicUnderscore !== undefined
              ? (["italic", groups.italicUnderscore] as const)
              : groups.code !== undefined
                ? (["code", groups.code] as const)
                : (["bold", undefined] as const);

    if (content === undefined) return matched;
    const wrap = dialect[marker];
    return wrap === undefined ? content : `${wrap}${content}${wrap}`;
  });
}
