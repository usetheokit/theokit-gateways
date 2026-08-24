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
interface SignalMessageEvent {
  readonly id: string;
  readonly platform: "signal";
  readonly sender: { readonly id: string; readonly username?: string };
  readonly channel: { readonly id: string; readonly type: "dm" | "group" | "thread" };
  readonly text: string;
  readonly receivedAt: number;
  readonly signal: {
    readonly senderUuid: string;
    readonly groupId?: string;
    readonly raw: unknown;
  };
}

// The registration itself — the mechanism under test. A third-party package writes exactly this
// block, against the published module specifier, from its own source.
declare module "@theokit/gateway" {
  interface PlatformEventRegistry {
    signal: SignalMessageEvent;
  }
}

const SIGNAL_EVENT: SignalMessageEvent = {
  id: "sg-1",
  platform: "signal",
  sender: { id: "uuid-abc" },
  channel: { id: "uuid-abc", type: "dm" },
  text: "hi from outside the monorepo",
  receivedAt: 1_700_000_000_000,
  signal: { senderUuid: "uuid-abc", raw: {} },
};

/**
 * Routes any event to a short id, narrowing per platform.
 *
 * The `never` default is the assertion that carries this file: it holds only while every member of
 * the union — the ten first-party platforms AND the foreign one registered above — has a case.
 */
function route(event: MessageEvent): string {
  switch (event.platform) {
    case "telegram":
      return `tg:${event.telegram.chatId}`;
    case "discord":
      return `dc:${event.discord.channelId}`;
    case "slack":
      return `sl:${event.slack.channelId}`;
    case "whatsapp":
      return `wa:${event.whatsapp.wamid}`;
    case "teams":
      return `tm:${event.teams.conversationId}`;
    case "email":
      return `em:${event.email.messageId}`;
    case "sms":
      return `sm:${event.sms.messageId}`;
    case "mattermost":
      return `mm:${event.mattermost.postId}`;
    case "line":
      return `ln:${event.line.messageId}`;
    case "matrix":
      return `mx:${event.matrix.eventId}`;
    case "signal":
      return `sg:${event.signal.senderUuid}`;
    default: {
      const unhandled: never = event;
      throw new Error(`unhandled platform: ${JSON.stringify(unhandled)}`);
    }
  }
}

describe("a gateway authored outside this repository", () => {
  it("registers a platform the core has never heard of", () => {
    // Without the augmentation this literal is not a `PlatformName` — which is exactly the
    // `TS2416` that B-008 measured against the published 0.6.1 declaration.
    const registered: PlatformName = "signal";

    expect(registered).toBe("signal");
  });

  it("narrows to the foreign variant's own fields", () => {
    expect(route(SIGNAL_EVENT)).toBe("sg:uuid-abc");
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
    ];

    expect(names).toHaveLength(11);
  });
});
