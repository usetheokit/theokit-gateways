/**
 * `MessageEvent` — canonical inbound shape every adapter emits (T1.1, ADR D173).
 *
 * Discriminated union keyed by `platform`. Platform-specific extensions live
 * in optional sibling fields (`telegram?`, `discord?`) typed by the adapter
 * package. The default narrow pattern is:
 *
 * ```typescript
 * switch (event.platform) {
 *   case "telegram": return event.telegram.threadId; // narrowed
 *   case "discord":  return event.discord.guildId;   // narrowed
 * }
 * ```
 *
 * This union is intentionally **closed** — adding a platform edits it here
 * rather than extending it externally. The trade-off (exhaustive narrowing over
 * OCP purity) is recorded in `docs/adr/0001-message-event-closed-union.md`.
 *
 * @public
 */

/**
 * Every platform filed in {@link PlatformEventRegistry}.
 *
 * Still a union of string literals, so `switch (event.platform)` narrows and a misspelled name is
 * a compile error — the property ADR-0001 protected and ADR-0002 preserves. What changed is that
 * the list is derived rather than written, so a package outside this repository can add to it.
 */
export type PlatformName = keyof PlatformEventRegistry & string;

/** Fields common to every platform's inbound event. */
export interface BaseMessageEvent {
  /** Stable id used as a session-key segment and for dedup. */
  readonly id: string;
  /** Discriminator. */
  readonly platform: PlatformName;
  /** Sender identity (opaque, platform-namespaced). */
  readonly sender: {
    readonly id: string;
    readonly username?: string;
    readonly displayName?: string;
  };
  /** Channel / chat scope (opaque, platform-namespaced). */
  readonly channel: {
    readonly id: string;
    readonly type: "dm" | "group" | "thread";
    readonly topicId?: string;
  };
  /** Plain-text content (caption for media-only messages; empty string when absent). */
  readonly text: string;
  /** Receipt timestamp (ms since epoch). */
  readonly receivedAt: number;
  /** Optional reply-target message id. */
  readonly replyTo?: string;
}

/** Telegram-specific event variant. */
export interface TelegramMessageEvent extends BaseMessageEvent {
  readonly platform: "telegram";
  readonly telegram: {
    readonly chatId: number;
    readonly messageId: number;
    readonly threadId?: number;
    /** Raw grammy `Context` — narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** Discord-specific event variant. */
export interface DiscordMessageEvent extends BaseMessageEvent {
  readonly platform: "discord";
  readonly discord: {
    readonly guildId: string | null;
    readonly channelId: string;
    readonly messageId: string;
    /** Raw discord.js `Message` — narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** Slack-specific event variant (ADR D274). */
export interface SlackMessageEvent extends BaseMessageEvent {
  readonly platform: "slack";
  readonly slack: {
    /** Slack workspace id (a.k.a. team_id). May be `undefined` for some legacy events. */
    readonly teamId: string | undefined;
    /** Slack channel id (Cxxxxxxxx | Gxxxxxxxx | Dxxxxxxxx). */
    readonly channelId: string;
    /** Slack user id (Uxxxxxxxx) or `"anonymous"` if absent. */
    readonly userId: string;
    /** Message timestamp = canonical Slack message id. */
    readonly ts: string;
    /** Set only when the message belongs to a thread. */
    readonly threadTs?: string;
    /** Slack message subtype (e.g. `"thread_broadcast"`). */
    readonly subtype?: string;
    /** Raw Bolt event body — narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** WhatsApp-specific event variant (ADR D308). */
export interface WhatsAppMessageEvent extends BaseMessageEvent {
  readonly platform: "whatsapp";
  readonly whatsapp: {
    /** WhatsApp message id — `wamid.xxx` for cloud, `msg.id._serialized` for web. */
    readonly wamid: string;
    /** Meta-issued phone-number-id (cloud only; undefined for web bridge). */
    readonly phoneNumberId?: string;
    /** Contact's profile name when Meta provides it. */
    readonly contactName?: string;
    /**
     * Which backend produced this event.
     *
     * `baileys` joined `cloud` and `web` in 0.2: it speaks the WhatsApp Web multi-device
     * protocol over a WebSocket, where `web` drives a headless browser. Consumers that
     * switch exhaustively on this must handle the third case.
     */
    readonly backend: "cloud" | "web" | "baileys";
    /** Raw envelope — backend-specific, narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** Microsoft Teams-specific event variant (ADR D325). */
export interface TeamsMessageEvent extends BaseMessageEvent {
  readonly platform: "teams";
  readonly teams: {
    /** Teams activity id (`MessageActivity.id`). */
    readonly activityId: string;
    /** Teams conversation id. */
    readonly conversationId: string;
    /** Teams conversation classification — open string per SDK type. */
    readonly conversationType: "personal" | "groupChat" | "channel" | (string & {});
    /** Tenant id of the sender (Azure AD). */
    readonly tenantId?: string;
    /** Channel id (only when conversationType === "channel"). */
    readonly channelId?: string;
    /** Team id (only when conversationType === "channel"). */
    readonly teamId?: string;
    /** Raw Teams `MessageActivity` — narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** Email-specific event variant (ADR D339). */
export interface EmailMessageEvent extends BaseMessageEvent {
  readonly platform: "email";
  readonly email: {
    /** Message-ID without `<>` braces. Use as `channel.topicId` for threading. */
    readonly messageId: string;
    /** Previous Message-ID this message replies to (without `<>`). */
    readonly inReplyTo?: string;
    /** Full References chain (oldest → newest, no braces). */
    readonly references?: readonly string[];
    /** Decoded Subject (fallback `"(no subject)"`). */
    readonly subject: string;
    /** Sender address (lowercased, normalized). */
    readonly fromAddress: string;
    /** Sender display name when present. */
    readonly fromName?: string;
    /** All To/Cc recipients lowercased; bot's own address EXCLUDED. */
    readonly recipients: readonly string[];
    /** Count of attachments (v0.1 drops payloads — see D335). */
    readonly attachmentCount: number;
    /** Raw `mailparser.ParsedMail` — escape hatch. */
    readonly raw: unknown;
  };
}

/** SMS-specific event variant (ADR D389). */
export interface SMSMessageEvent extends BaseMessageEvent {
  readonly platform: "sms";
  readonly sms: {
    /** Which backend processed this inbound. */
    readonly backend: "twilio" | "plivo" | "vonage";
    /** Provider message id (Twilio MessageSid, Plivo MessageUuid, Vonage messageId). */
    readonly messageId: string;
    /** Sender phone in E.164 format (D391). */
    readonly from: string;
    /** Recipient phone in E.164 format (D391). */
    readonly to: string;
    /** Raw webhook payload — backend-specific, narrowed by the adapter package. */
    readonly raw: unknown;
  };
}

/** Mattermost-specific event variant (ADR D397). */
export interface MattermostMessageEvent extends BaseMessageEvent {
  readonly platform: "mattermost";
  readonly mattermost: {
    /** Mattermost post id. */
    readonly postId: string;
    /** Channel id (Mattermost internal id). */
    readonly channelId: string;
    /** Team id the channel belongs to. */
    readonly teamId: string;
    /** When set, the message is a thread reply rooted at this post id (D399). */
    readonly rootId?: string;
    /** Original Mattermost channel type (`D`/`G`/`O`/`P`) before normalization (D402). */
    readonly channelType: "D" | "G" | "O" | "P" | (string & {});
    /** Raw `@mattermost/client` Post — escape hatch. */
    readonly raw: unknown;
  };
}

/** LINE-specific event variant (ADR D405). */
export interface LineMessageEvent extends BaseMessageEvent {
  readonly platform: "line";
  readonly line: {
    /** LINE source classification (D410). */
    readonly sourceType: "user" | "group" | "room";
    /** LINE source id (userId / groupId / roomId). */
    readonly sourceId: string;
    /** LINE message id. */
    readonly messageId: string;
    /** UserIds mentioned in the message (D409 — never inline). */
    readonly mentionees: ReadonlyArray<string>;
    /** Reply token (one-shot, 60s TTL). Adapter manages cache — caller should not use directly. */
    readonly replyToken?: string;
    /** Raw LINE webhook event — escape hatch. */
    readonly raw: unknown;
  };
}

/** Matrix-specific event variant (ADR D413). */
export interface MatrixMessageEvent extends BaseMessageEvent {
  readonly platform: "matrix";
  readonly matrix: {
    /** Matrix room id (`!xxx:server`). */
    readonly roomId: string;
    /** Matrix event id (`$xxx:server`). */
    readonly eventId: string;
    /** Number of joined members in the room — used for DM detection (D416). */
    readonly memberCount: number;
    /** Raw `matrix-js-sdk` `MatrixEvent` — escape hatch (D421). */
    readonly raw: unknown;
  };
}

/** Discriminated union of all platform variants. */
/**
 * The open registry every platform's inbound event is filed under.
 *
 * **This is an `interface` on purpose, and it must stay one.** An interface can be extended from
 * another package through declaration merging; a type alias cannot. That single property is what
 * lets a gateway be authored, published and consumed without editing this file — the capability
 * B-008 measured as impossible (`TS2416`, compiled against the published declaration) and ADR-0002
 * decided to unlock. Collapsing it back into a type alias would silently remove that capability
 * while every test in this package still passed.
 *
 * A third-party gateway registers itself from its own package:
 *
 * ```typescript
 * declare module "@theokit/gateway" {
 *   interface PlatformEventRegistry {
 *     signal: SignalMessageEvent;
 *   }
 * }
 * ```
 *
 * @public
 */
export interface PlatformEventRegistry {
  telegram: TelegramMessageEvent;
  discord: DiscordMessageEvent;
  slack: SlackMessageEvent;
  whatsapp: WhatsAppMessageEvent;
  teams: TeamsMessageEvent;
  email: EmailMessageEvent;
  sms: SMSMessageEvent;
  mattermost: MattermostMessageEvent;
  line: LineMessageEvent;
  matrix: MatrixMessageEvent;
}

/**
 * `true` only for `any` — the one type that would otherwise swallow the union.
 *
 * `any extends X` distributes to both branches of a conditional, so an ordinary
 * `T extends BaseMessageEvent ? T : never` does NOT keep `any` out. This does: nothing but `any`
 * makes `1 & T` accept `0`.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * A registry entry joins {@link MessageEvent} only if it is a real event shape (ADR D425).
 *
 * Measured, not anticipated: without this guard a single entry typed `any` collapses the whole
 * union, and `tsc --strict` then accepts `event.completelyMadeUpField.nested.nonsense` on EVERY
 * consumer — ours included — with no error in any package and nothing red in any suite. The closed
 * union could not fail that way, so the guard is what keeps the new capability from costing a
 * safety property the old design had.
 *
 * A malformed entry is EXCLUDED rather than fatal, which also fixes the blast direction: the
 * author's own `case` stops narrowing, and first-party consumers are untouched.
 *
 * Exported for the contract test in `tests/types/registry-guard.test.ts`, which asserts against
 * this type rather than a copy of it — a copy would stay green with the guard deleted. It is
 * deliberately NOT re-exported from the package barrel; it is an implementation detail of the
 * derivation, not part of the published surface.
 */
export type Registered<T> = IsAny<T> extends true ? never : T extends BaseMessageEvent ? T : never;

/**
 * The canonical inbound event: every guarded entry in {@link PlatformEventRegistry}.
 *
 * Derived rather than written, so third-party platforms are included automatically and exhaustive
 * narrowing still holds over all of them.
 *
 * @public
 */
export type MessageEvent = {
  [K in keyof PlatformEventRegistry]: Registered<PlatformEventRegistry[K]>;
}[keyof PlatformEventRegistry];
