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
 * `gateway-signal`, added later, edits a body and stays on the transport side of that line:
 * Signal carries emphasis as `textStyle` ranges sent beside the text, so the adapter moves a
 * markdown reply's markers into those ranges. Its rendering row is `markdown` with identity, and
 * nothing here translates for it.
 *
 * `gateway-imessage`, `gateway-google-chat` and `gateway-irc`, added with it, send to platforms
 * with no markup at all, and their rendering rows are `plain`. A presenter given
 * `channelRendering(platform)` hands them text already translated and declared `plain`. A caller
 * that sends `format: "markdown"` without that step would put the asterisks in front of the user,
 * so those three adapters apply their own row in that one case, as a fallback. The presenter is
 * still where translation is decided, and the row they apply is the one it would have applied.
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
export interface Dialect {
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
 *
 * `channelRendering` reuses the whatsapp, line and sms rows rather than spelling them again. Like
 * `Dialect` and `rewriteMarkers`, it is exported for that module only: the package entry does not
 * re-export it, so no consumer can reach it.
 */
export const DIALECTS = {
  // WhatsApp emphasis is inline and single-character: *bold*, _italic_, ~strike~, ```mono```.
  whatsapp: { bold: "*", italic: "_", strike: "~", code: "```" },
  // LINE text messages carry no rich text at all — decoration is emoji-only. Markers are dropped.
  line: {},
  // SMS is plain text by definition of the medium.
  sms: {},
} as const satisfies Readonly<Record<string, Dialect>>;

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
 * Which capture group becomes which dialect marker, in the order `PATTERN` alternates.
 *
 * A table rather than a chain of conditionals, because the two ITALIC spellings make a chain read as
 * five decisions when it encodes one lookup — and biome measured the enclosing function at a
 * cognitive complexity of 26 against a ceiling of 10. Adding a marker is a row here and an
 * alternative in `PATTERN`; nothing else moves.
 *
 * Order here does NOT matter, and the first draft of this comment said it did. `PATTERN` alternates,
 * so at most one group carries a value per match — which is exactly why the loop may return on the
 * first one it finds. Checked rather than asserted: moving `italicStar` above `bold` leaves all
 * seven tests green, while deleting a row fails two. Order is load-bearing in `PATTERN`, not here.
 */
const GROUP_MARKERS = [
  ["bold", "bold"],
  ["strike", "strike"],
  ["italicStar", "italic"],
  ["italicUnderscore", "italic"],
  ["code", "code"],
] as const satisfies ReadonlyArray<readonly [string, keyof Dialect]>;

/**
 * Rewrite `text` for `platform`.
 *
 * @param text - the assembled answer, in markdown as the model produced it
 * @param platform - the destination; one this function has not been taught passes through
 * @returns the text in the platform's dialect, or unchanged when none is known
 * @public
 */
export function toDialect(text: string, platform: string): string {
  const dialect = (DIALECTS as Readonly<Record<string, Dialect>>)[platform];
  if (dialect === undefined) return text;
  return rewriteMarkers(text, dialect);
}

/**
 * Rewrite the four inline markers of `text` into `dialect`, in one pass over `PATTERN`.
 *
 * Shared by `toDialect` and `channelRendering`, so the one regex whose ordering is load-bearing
 * exists once: a second copy is where the bold-becomes-italic defect above would come back.
 *
 * @param text - markdown as the model produced it
 * @param dialect - what each marker becomes; an absent marker is dropped and its content kept
 * @returns the rewritten text
 */
export function rewriteMarkers(text: string, dialect: Dialect): string {
  return text.replace(PATTERN, (matched, ...args) => {
    const groups = args.at(-1) as Record<string, string | undefined> | undefined;
    if (groups === undefined) return matched;

    for (const [group, marker] of GROUP_MARKERS) {
      const content = groups[group];
      if (content === undefined) continue;
      const wrap = dialect[marker];
      return wrap === undefined ? content : `${wrap}${content}${wrap}`;
    }

    // PATTERN matched and named no group: unreachable while every alternative above carries one,
    // and returning the match unchanged is the only answer that cannot corrupt text if it stops
    // being true. The same reason the whole module passes an unknown platform through.
    return matched;
  });
}
