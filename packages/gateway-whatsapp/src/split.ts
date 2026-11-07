/**
 * Split a long string into ≤4096-char chunks for WhatsApp messages (ADR D310).
 *
 * Thin wrapper over core `chunkText` (roadmap M1). WhatsApp family: fixed 4096
 * window, `\n\n` → `\n` → ` ` boundary preference, UTF-16 surrogate-pair guard,
 * leading-whitespace strip. `trimParts` reproduces EC-8 (empty parts filtered
 * so consecutive newlines don't yield empty `sendMessage` calls Meta rejects).
 * Output is byte-identical to the previous implementation (pinned by
 * `tests/split.test.ts`).
 *
 * @internal
 */

import { chunkText } from "@theokit/gateway";

const WHATSAPP_MAX_TEXT = 4096;

export function splitForWhatsApp(text: string): string[] {
  return chunkText(text, {
    limit: WHATSAPP_MAX_TEXT,
    boundaries: ["\n\n", "\n", " "],
    lastResort: "last-boundary",
    surrogateGuard: true,
    stripLeading: /^\s+/,
    trimParts: true,
    keepTableRows: true,
  });
}
