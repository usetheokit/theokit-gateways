/**
 * The Tlon `chat` app's wire shapes, in one module so a live run can confirm or replace them in
 * one place. They are Reported, read from OpenClaw's Tlon extension at `abd280635b`:
 * `extensions/tlon/src/urbit/send.ts` lines 41 to 80 (the DM poke), `monitor/index.ts` lines 874
 * (`chat-dm-rsvp`) and 903 to 925 (`whom`, `id`, `response.add.essay`), 1025 to 1048 (`chat` at
 * `/v3`). Nothing here has been observed against a ship yet (AC-042).
 */

import { da, scot } from "@urbit/aura";

/** What one `/v3` fact is to the adapter. */
export type ChatFact =
  | {
      readonly kind: "essay";
      /** The DM partner's ship (or a club id for a group DM). */
      readonly whom: string;
      readonly id: string;
      readonly author: string;
      readonly text: string;
      readonly sent: number;
    }
  | { readonly kind: "invites"; readonly ships: readonly string[] }
  | { readonly kind: "other" };

/** `~name` for `name` or `~name`. */
export function normalizeShip(ship: string): string {
  const trimmed = ship.trim();
  return trimmed.startsWith("~") ? trimmed : `~${trimmed}`;
}

/** Read one `/v3` fact. */
export function readChatFact(fact: unknown): ChatFact {
  if (Array.isArray(fact)) {
    const ships = fact
      .map((invite) => (invite as { ship?: unknown } | null)?.ship)
      .filter((ship): ship is string => typeof ship === "string" && ship.length > 0)
      .map(normalizeShip);
    return { kind: "invites", ships };
  }
  const record = (fact ?? {}) as { whom?: unknown; id?: unknown; response?: unknown };
  const essay = (record.response as { add?: { essay?: unknown } } | undefined)?.add?.essay as
    | { author?: unknown; sent?: unknown; content?: unknown }
    | undefined;
  if (typeof record.whom !== "string" || typeof record.id !== "string" || essay === undefined) {
    return { kind: "other" };
  }
  return {
    kind: "essay",
    whom: record.whom,
    id: record.id,
    author: typeof essay.author === "string" ? normalizeShip(essay.author) : "",
    text: textOf(essay.content),
    sent: typeof essay.sent === "number" ? essay.sent : 0,
  };
}

/** The string inlines of every verse, verses on their own lines; other inlines are skipped. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((verse) => (verse as { inline?: unknown } | null)?.inline)
    .filter((inline): inline is unknown[] => Array.isArray(inline))
    .map((inline) => inline.filter((part): part is string => typeof part === "string").join(""))
    .join("\n");
}

/** The `chat-dm-action` poke of one DM, and the id the message will carry. */
export interface DmPoke {
  readonly json: unknown;
  readonly messageId: string;
  /** The `sent` time used, ms; later than `previous` so two sends never share an id (EC-15). */
  readonly sentAt: number;
}

/**
 * Build the poke that sends `text` from `fromShip` to `toShip`.
 *
 * @param previous the `sentAt` of this adapter's previous send, so a send in the same
 *   millisecond is dated one millisecond later and gets its own `@ud` id
 */
export function dmPoke(
  fromShip: string,
  toShip: string,
  text: string,
  now: number,
  previous: number | undefined,
): DmPoke {
  const sentAt = previous !== undefined && now <= previous ? previous + 1 : now;
  const messageId = `${fromShip}/${scot("ud", da.fromUnix(sentAt))}`;
  return {
    messageId,
    sentAt,
    json: {
      ship: toShip,
      diff: {
        id: messageId,
        delta: {
          add: {
            memo: { content: [{ inline: [text] }], author: fromShip, sent: sentAt },
            kind: null,
            time: null,
          },
        },
      },
    },
  };
}

/** The `chat-dm-rsvp` poke json that accepts a DM invite from `ship`. */
export function rsvpPoke(ship: string): { ship: string; ok: true } {
  return { ship, ok: true };
}
