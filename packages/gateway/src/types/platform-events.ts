/**
 * The event variants of the platforms added in S-003: batch 1 (B-354 to B-358) and batch 2 (B-359
 * to B-363).
 *
 * They live beside `message-event.ts` rather than in it to keep that file, which holds the registry
 * and its guard, within the 500-line budget. `message-event.ts` files each of them under its key
 * in `PlatformEventRegistry`; the package barrel exports them.
 */

import type { BaseMessageEvent } from "./message-event.js";

/** Signal-specific event variant (B-354), received from `signal-cli jsonRpc`. */
export interface SignalMessageEvent extends BaseMessageEvent {
  readonly platform: "signal";
  readonly signal: {
    /** Envelope timestamp (ms since epoch); Signal's own message id. */
    readonly timestamp: number;
    /** Sender's phone number, when signal-cli knows it. */
    readonly sourceNumber?: string;
    /** Sender's account UUID, when signal-cli knows it. */
    readonly sourceUuid?: string;
    /** Group id, present only for a group message. */
    readonly groupId?: string;
    /** Raw signal-cli envelope — escape hatch. */
    readonly raw: unknown;
  };
}

/** iMessage-specific event variant (B-355), received from `imsg rpc` on a signed-in Mac. */
export interface IMessageMessageEvent extends BaseMessageEvent {
  readonly platform: "imessage";
  readonly imessage: {
    /** `imsg`'s numeric chat id; the send target for a reply. */
    readonly chatId: number;
    /** Messages' own message GUID. */
    readonly guid: string;
    /** `imsg`'s `is_group` for the chat; agrees with `channel.type === "group"`. */
    readonly isGroup: boolean;
    /** Participant handles (phone numbers or emails) as `imsg` reports them for the chat. */
    readonly participants: readonly string[];
    /** Raw `imsg` notification payload — escape hatch. */
    readonly raw: unknown;
  };
}

/** Google Chat-specific event variant (B-356), posted to the Chat app's HTTPS endpoint. */
export interface GoogleChatMessageEvent extends BaseMessageEvent {
  readonly platform: "google_chat";
  readonly google_chat: {
    /** The message's resource name, `spaces/<space>/messages/<message>`. */
    readonly messageName: string;
    /** The space's resource name, `spaces/<space>`; the send target for a reply. */
    readonly spaceName: string;
    /** The space's `spaceType` (`SPACE`, `GROUP_CHAT` or `DIRECT_MESSAGE`), when Chat sent one. */
    readonly spaceType?: string;
    /** The thread's resource name, when the message is in a thread. */
    readonly threadName?: string;
    /** Raw Chat event — escape hatch. */
    readonly raw: unknown;
  };
}

/** IRC-specific event variant (B-357), read from a PRIVMSG on the adapter's own connection. */
export interface IrcMessageEvent extends BaseMessageEvent {
  readonly platform: "irc";
  readonly irc: {
    /** Where the PRIVMSG was addressed: a channel, `#name`, or the adapter's own nick for a DM. */
    readonly target: string;
    /** The sender's nick, from the line's prefix. */
    readonly nick: string;
    /** True for a CTCP ACTION (`/me`); `text` then holds the action without its CTCP framing. */
    readonly action: boolean;
    /** The line's IRCv3 message tags, unescaped; empty when the server sent none. */
    readonly tags: Readonly<Record<string, string>>;
    /** The raw line as the server sent it, without CRLF — escape hatch. */
    readonly raw: string;
  };
}

/**
 * Nextcloud Talk event variant (B-358), read from a bot webhook `Create` activity that carried a
 * signature the adapter verified.
 */
export interface NextcloudTalkMessageEvent extends BaseMessageEvent {
  readonly platform: "nextcloud_talk";
  readonly nextcloud_talk: {
    /** The conversation's token, the `target.id` of the activity; a reply goes to it. */
    readonly roomToken: string;
    /** Talk's id for the message, the activity's `object.id`. */
    readonly messageId: string;
    /** Who wrote it, as Talk names actors: `users/<id>`, `guests/<id>`, `bots/<id>`… */
    readonly actorId: string;
    /** The id of the message this one answers, when it is a reply. */
    readonly replyToId?: string;
    /** The parsed webhook body — escape hatch. */
    readonly raw: unknown;
  };
}

/** Nostr event variant (B-359): a NIP-17 direct message (kind 14) or a NIP-04 one (kind 4). */
export interface NostrMessageEvent extends BaseMessageEvent {
  readonly platform: "nostr";
  readonly nostr: {
    /** The sender's public key, 64 lowercase hex characters; the send target for a reply. */
    readonly pubkey: string;
    /** 14 for a NIP-17 rumor unwrapped from a gift wrap, 4 for a NIP-04 encrypted message. */
    readonly kind: 4 | 14;
    /** The message's `created_at` in Unix seconds, as its sender stated it. */
    readonly createdAt: number;
    /** The decrypted rumor or kind 4 event — escape hatch. */
    readonly raw: unknown;
  };
}

/** Feishu/Lark event variant (B-360), an `im.message.receive_v1` event from the long connection. */
export interface FeishuLarkMessageEvent extends BaseMessageEvent {
  readonly platform: "feishu_lark";
  readonly feishu_lark: {
    /** The chat's `chat_id`; the send target for a reply. */
    readonly chatId: string;
    /** The message's `message_id`. */
    readonly messageId: string;
    /** The sender's `open_id`. */
    readonly openId: string;
    /** The event's `event_id`, which a redelivery repeats. */
    readonly eventId: string;
    /** Raw event — escape hatch. */
    readonly raw: unknown;
  };
}

/** Synology Chat event variant (B-361), an outgoing bot callback from the NAS. */
export interface SynologyChatMessageEvent extends BaseMessageEvent {
  readonly platform: "synology_chat";
  readonly synology_chat: {
    /** The sender's numeric user id; a reply goes to `user_ids: [userId]`. */
    readonly userId: number;
    /** The sender's user name. */
    readonly username: string;
    /** The callback's `post_id`. */
    readonly postId: string;
    /** The callback's `timestamp`. */
    readonly timestamp: number;
    /** The parsed callback body — escape hatch. */
    readonly raw: unknown;
  };
}

/** Tlon event variant (B-362), a DM read from the ship's `chat` app at `/v3`. */
export interface TlonUrbitMessageEvent extends BaseMessageEvent {
  readonly platform: "tlon_urbit";
  readonly tlon_urbit: {
    /** The sender's ship, `~name`; the send target for a reply. */
    readonly ship: string;
    /** The message id, `<ship>/<@ud>`. */
    readonly messageId: string;
    /** The essay's `sent` time in Unix milliseconds. */
    readonly sent: number;
    /** The `/v3` event — escape hatch. */
    readonly raw: unknown;
  };
}

/** Twitch event variant (B-363), a `channel.chat.message` EventSub notification. */
export interface TwitchMessageEvent extends BaseMessageEvent {
  readonly platform: "twitch";
  readonly twitch: {
    /** The channel's broadcaster user id; the send target for a reply. */
    readonly broadcasterUserId: string;
    /** The chatter's user id. */
    readonly chatterUserId: string;
    /** The chatter's login name. */
    readonly chatterLogin: string;
    /** The chat message's `message_id`. */
    readonly messageId: string;
    /** The notification's `event` object — escape hatch. */
    readonly raw: unknown;
  };
}
