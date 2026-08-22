/**
 * Who is allowed to reach the handler — a fail-closed sender allowlist.
 *
 * Until this existed the package had no sender filter. `shouldDropGroupMessage` fires only for
 * *groups* with `requireMention`, so any stranger who sent a direct message reached the agent.
 *
 * That is two problems wearing one coat. A number that answers strangers accumulates blocks and
 * reports, which is what WhatsApp's enforcement runs on — so an open gateway is a slow route to a
 * banned number. And an agent wired to tools acts on what arrives, so an unfiltered inbound is an
 * instruction channel for anyone who knows the number. Baileys' own `GHSA-qvv5-jq5g-4cgg` — a
 * crafted `protocolMessage` that forges a `messages.upsert` — is the same hazard reached through
 * the library rather than through the phone, and an allowlist narrows both.
 *
 * Pure by construction: no socket, no I/O, no clock. The decision is the part worth testing, and
 * it can be tested exhaustively without a phone number, which the transport around it cannot.
 *
 * @public
 */

/** Allows every identified sender. Must be set deliberately; it is never the default. */
const WILDCARD = "*";

/**
 * Reduce a WhatsApp identifier to the digits that identify the account.
 *
 * WhatsApp addresses carry two things that are not part of the number: a device suffix
 * (`:12`) and a domain (`@s.whatsapp.net`, `@g.us`, `@lid`). Stripping non-digits without
 * removing the suffix first merges the device id into the number —
 * `5511999999999:12@s.whatsapp.net` becomes `551199999999912`, which matches no allowlist entry,
 * so the filter silently stops recognising that sender the moment they use a second device.
 *
 * Returns `""` when the input carries no identifier at all. Callers must treat that as
 * unidentified, never as a match.
 */
export function normalizeWhatsAppId(value: string): string {
  const withoutDevice = value.replace(/:[^@]*(?=@)/, "");
  const withoutDomain = withoutDevice.replace(/@.*$/, "");
  return withoutDomain.replace(/\D/g, "");
}

/**
 * Parse a comma-separated allowlist into normalised entries.
 *
 * Blank entries are dropped rather than kept: an empty string is what an unreadable identifier
 * normalises to, so admitting `""` to the set would admit precisely the senders whose id could
 * not be read. The wildcard is preserved verbatim, since normalising it would erase it.
 */
export function parseAllowedSenders(raw: string | undefined): ReadonlySet<string> {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .map((entry) => (entry === WILDCARD ? WILDCARD : normalizeWhatsAppId(entry)))
    .filter((entry) => entry.length > 0);
  return new Set(entries);
}

/**
 * May `senderId` reach the handler?
 *
 * **Fail-closed.** An empty allowlist admits nobody. An operator who has not configured one has
 * not decided who may drive the agent, and the safe reading of "has not decided" is "not yet" —
 * not "everyone". The inverse default is a mistake worth naming: it makes the safest-looking
 * configuration, the empty one, the most open.
 *
 * An unidentifiable sender is refused even under the wildcard. `*` means "any sender", and
 * something whose sender cannot be named is not a sender; letting it through would make the
 * wildcard the single path that skips identification altogether.
 */
export function isSenderAllowed(senderId: string, allowed: ReadonlySet<string>): boolean {
  const normalized = normalizeWhatsAppId(senderId);
  if (normalized.length === 0) return false;
  if (allowed.size === 0) return false;
  if (allowed.has(WILDCARD)) return true;
  return allowed.has(normalized);
}
