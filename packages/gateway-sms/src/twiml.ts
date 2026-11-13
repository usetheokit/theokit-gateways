/**
 * Minimal TwiML builders. Every text node and attribute value is XML-escaped.
 *
 * @public
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping XML-illegal controls on purpose
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function esc(s: string): string {
  return s
    .replace(ILLEGAL, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attrs(a: Record<string, string | number | undefined>): string {
  let out = "";
  for (const [k, v] of Object.entries(a)) {
    if (v !== undefined) out += ` ${k}="${esc(String(v))}"`;
  }
  return out;
}

/** @public */
export const twiml = {
  say(text: string, opts: { voice?: string; language?: string } = {}): string {
    return `<Say${attrs({ voice: opts.voice, language: opts.language })}>${esc(text)}</Say>`;
  },
  gather(opts: {
    action: string;
    input?: "speech" | "dtmf";
    timeoutSeconds?: number;
    prompt?: string;
  }): string {
    const a = attrs({ action: opts.action, input: opts.input, timeout: opts.timeoutSeconds });
    return opts.prompt === undefined
      ? `<Gather${a}/>`
      : `<Gather${a}>${twiml.say(opts.prompt)}</Gather>`;
  },
  redirect(url: string): string {
    return `<Redirect>${esc(url)}</Redirect>`;
  },
  hangup(): string {
    return "<Hangup/>";
  },
  /** Wrap verbs in `<Response>`. Verbs must come from the builders above. */
  response(...verbs: string[]): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${verbs.join("")}</Response>`;
  },
};
