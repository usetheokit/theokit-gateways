/**
 * A gateway authored outside this repository — proved through the PUBLISHED entry point.
 *
 * This is the whole point of B-008, and where it is asserted matters more than what it asserts.
 * The test imports `@theokit/gateway` as a package, so TypeScript resolves it through the manifest's
 * `types` field to `dist/index.d.ts` — the same declaration an npm consumer receives. A test placed
 * next to the source would import `src/` and be blind to the one defect this arrangement exists to
 * catch — see `docs/adr/0002-platform-event-registry.md` § Consequences.
 *
 * That defect is not hypothetical. During the measurement for B-008 the first registry build
 * emitted `PlatformEventRegistry` into the declaration and omitted it from the barrel's export
 * list, because the barrel re-exports types by name. Every source-level check passed. A third party
 * could not have augmented an unexported interface, so the design would have shipped broken and
 * green — and only a test resolving through the published surface would have said so.
 *
 * These assertions run at `tsc`; `vitest` proves the file was collected.
 */

import type { MessageEvent, PlatformName } from "@theokit/gateway";
import { describe, expect, it } from "vitest";

/** A platform the core has never heard of, shaped the way a real third-party gateway would shape it. */
interface AcmeChatMessageEvent {
  readonly id: string;
  readonly platform: "acmechat";
  readonly sender: { readonly id: string; readonly username?: string };
  readonly channel: { readonly id: string; readonly type: "dm" | "group" | "thread" };
  readonly text: string;
  readonly receivedAt: number;
  readonly acmechat: {
    readonly senderUuid: string;
    readonly groupId?: string;
    readonly raw: unknown;
  };
}

// The registration itself — the mechanism under test. A third-party package writes exactly this
// block, against the published module specifier, from its own source.
declare module "@theokit/gateway" {
  interface PlatformEventRegistry {
    acmechat: AcmeChatMessageEvent;
  }
}

const ACMECHAT_EVENT: AcmeChatMessageEvent = {
  id: "ac-1",
  platform: "acmechat",
  sender: { id: "uuid-abc" },
  channel: { id: "uuid-abc", type: "dm" },
  text: "hi from outside the monorepo",
  receivedAt: 1_700_000_000_000,
  acmechat: { senderUuid: "uuid-abc", raw: {} },
};

/** One router per platform, each receiving only that platform's variant. */
type Routes = {
  readonly [P in PlatformName]: (event: Extract<MessageEvent, { platform: P }>) => string;
};

/**
 * Routes any event to a short id, narrowing per platform.
 *
 * The mapped `Routes` type is the assertion that carries this file: the table compiles only while
 * every member of the union — the first-party platforms AND the foreign one registered above — has
 * an entry, and only with the fields that member declares.
 */
const ROUTES: Routes = {
  telegram: (event) => `tg:${event.telegram.chatId}`,
  discord: (event) => `dc:${event.discord.channelId}`,
  slack: (event) => `sl:${event.slack.channelId}`,
  whatsapp: (event) => `wa:${event.whatsapp.wamid}`,
  teams: (event) => `tm:${event.teams.conversationId}`,
  email: (event) => `em:${event.email.messageId}`,
  sms: (event) => `sm:${event.sms.messageId}`,
  mattermost: (event) => `mm:${event.mattermost.postId}`,
  line: (event) => `ln:${event.line.messageId}`,
  matrix: (event) => `mx:${event.matrix.eventId}`,
  signal: (event) => `sg:${event.signal.timestamp}`,
  imessage: (event) => `im:${event.imessage.guid}`,
  google_chat: (event) => `gc:${event.google_chat.messageName}`,
  irc: (event) => `irc:${event.irc.nick}`,
  nextcloud_talk: (event) => `nextcloud_talk:${event.nextcloud_talk.roomToken}`,
  nostr: (event) => `ns:${event.nostr.pubkey}`,
  feishu_lark: (event) => `fl:${event.feishu_lark.messageId}`,
  synology_chat: (event) => `sc:${event.synology_chat.postId}`,
  tlon_urbit: (event) => `tu:${event.tlon_urbit.messageId}`,
  twitch: (event) => `tw:${event.twitch.messageId}`,
  acmechat: (event) => `ac:${event.acmechat.senderUuid}`,
};

function route<E extends MessageEvent>(event: E): string {
  const handler = ROUTES[event.platform] as (event: E) => string;
  return handler(event);
}

describe("a gateway authored outside this repository", () => {
  it("registers a platform the core has never heard of", () => {
    // Without the augmentation this literal is not a `PlatformName` — which is exactly the
    // `TS2416` that B-008 measured against the published 0.6.1 declaration.
    const registered: PlatformName = "acmechat";

    expect(registered).toBe("acmechat");
  });

  it("narrows to the foreign variant's own fields", () => {
    expect(route(ACMECHAT_EVENT)).toBe("ac:uuid-abc");
  });

  it("still rejects a platform nobody registered", () => {
    // NEGATIVE — augmenting one platform must not open the door to every string. A typo stays a
    // compile error, which is the property that separates this from opening the union outright.
    // @ts-expect-error — "sgnal" was never registered
    const typo: PlatformName = "sgnal";

    expect(typo).toBe("sgnal");
  });

  it("keeps every first-party platform reachable", () => {
    // The foreign registration must ADD to the union, never replace it.
    const names: PlatformName[] = [
      "telegram",
      "discord",
      "slack",
      "whatsapp",
      "teams",
      "email",
      "sms",
      "mattermost",
      "line",
      "matrix",
      "signal",
      "imessage",
      "google_chat",
      "irc",
      "nextcloud_talk",
      "acmechat",
    ];

    expect(names).toHaveLength(16);
  });
});
