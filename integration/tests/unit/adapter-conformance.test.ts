/**
 * One contract, every adapter — asserted by behaviour, against all of them at once.
 *
 * `packages/gateway/tests/lint/adapter-contract.test.ts` already holds every adapter to a set of
 * invariants, and it does it by reading source text. That was the right tool for what it catches
 * — a guard deleted, a rejection floated — and it is the wrong tool for what this catches, because
 * a regex can only ever assert that a shape is present. It cannot run the thing.
 *
 * The difference is not academic. Getting that lint file honest took five attempts across this
 * repository's history, four of which passed while checking nothing: a regex that matched zero
 * declarations, a window that reached into the neighbouring method and accepted its guard, a
 * brace matcher fooled by a string literal, a floor that only fired when the count dropped. Every
 * one of those was a statement about text that read like a statement about behaviour.
 *
 * This file makes the same claims by constructing each adapter and calling it. Nothing here needs
 * a credential or a network: every assertion is about what an adapter does BEFORE it connects, or
 * about a promise it makes regardless of connection. That is deliberate — a conformance suite
 * that needs provisioning is a conformance suite that does not run.
 *
 * `whatsapp` is absent by construction, not by oversight: its adapter takes a backend rather than
 * credentials, and its three backends have their own conformance suite one level down, in
 * `packages/gateway-whatsapp/tests/backend-conformance.test.ts`.
 */

import type { BasePlatformAdapter } from "@theokit/gateway";
import { DiscordAdapter } from "@theokit/gateway-discord";
import { EmailAdapter } from "@theokit/gateway-email";
import { FeishuLarkAdapter } from "@theokit/gateway-feishu-lark";
import { GoogleChatAdapter } from "@theokit/gateway-google-chat";
import { IMessageAdapter } from "@theokit/gateway-imessage";
import { IrcAdapter } from "@theokit/gateway-irc";
import { LineAdapter } from "@theokit/gateway-line";
import { MatrixAdapter } from "@theokit/gateway-matrix";
import { MattermostAdapter } from "@theokit/gateway-mattermost";
import { NextcloudTalkAdapter } from "@theokit/gateway-nextcloud-talk";
import { NostrAdapter } from "@theokit/gateway-nostr";
import { SignalAdapter } from "@theokit/gateway-signal";
import { SlackAdapter } from "@theokit/gateway-slack";
import { SMSAdapter } from "@theokit/gateway-sms";
import { SynologyChatAdapter } from "@theokit/gateway-synology-chat";
import { TeamsAdapter } from "@theokit/gateway-teams";
import { TelegramAdapter } from "@theokit/gateway-telegram";
import { TlonUrbitAdapter } from "@theokit/gateway-tlon-urbit";
import { TwitchAdapter } from "@theokit/gateway-twitch";
import { describe, expect, it } from "vitest";

/**
 * Every adapter, built with credentials shaped like the real thing and valid nowhere.
 *
 * Shaped rather than blank because several constructors validate, and rightly: a blank token is a
 * programmer error and failing at construction is the correct answer to one. What this suite
 * exercises is the layer above that — an adapter correctly built and not yet connected.
 */
const ADAPTERS: readonly { platform: string; make: () => BasePlatformAdapter }[] = [
  { platform: "discord", make: () => new DiscordAdapter({ token: "not-a-real-token" }) },
  {
    platform: "email",
    make: () =>
      new EmailAdapter({
        imapHost: "imap.invalid",
        smtpHost: "smtp.invalid",
        address: "nobody@invalid",
        password: "not-a-real-password",
      }),
  },
  {
    platform: "feishu_lark",
    make: () => new FeishuLarkAdapter({ appId: "cli_0000000000000000", appSecret: "not-a-secret" }),
  },
  {
    platform: "google_chat",
    make: () =>
      new GoogleChatAdapter({
        serviceAccountEmail: "nobody@not-a-project.iam.gserviceaccount.com",
        privateKey: "not-a-real-key",
        audience: "https://chat.invalid/google-chat",
      }),
  },
  {
    platform: "imessage",
    make: () => new IMessageAdapter({ cliPath: "imsg-not-installed" }),
  },
  {
    platform: "irc",
    make: () => new IrcAdapter({ host: "irc.invalid", nick: "nobody", channels: ["#nowhere"] }),
  },
  {
    platform: "line",
    make: () =>
      new LineAdapter({ channelAccessToken: "not-a-real-token", channelSecret: "not-a-secret" }),
  },
  {
    platform: "matrix",
    make: () =>
      new MatrixAdapter({
        homeserverUrl: "https://matrix.invalid",
        accessToken: "not-a-real-token",
        userId: "@nobody:matrix.invalid",
      }),
  },
  {
    platform: "mattermost",
    make: () =>
      new MattermostAdapter({ baseUrl: "https://mm.invalid", accessToken: "not-a-real-token" }),
  },
  {
    platform: "nextcloud_talk",
    make: () =>
      new NextcloudTalkAdapter({
        baseUrl: "https://nextcloud.invalid",
        secret: "not-a-real-bot-secret-but-forty-characters-long",
      }),
  },
  {
    platform: "nostr",
    make: () => new NostrAdapter({ secretKey: "1".repeat(64), relays: ["wss://relay.invalid"] }),
  },
  {
    platform: "signal",
    make: () =>
      new SignalAdapter({ account: "+15550000000", signalCliPath: "signal-cli-not-installed" }),
  },
  {
    platform: "slack",
    make: () => new SlackAdapter({ botToken: "xoxb-not-real", appToken: "xapp-not-real" }),
  },
  {
    platform: "sms",
    make: () =>
      new SMSAdapter({
        backend: "twilio",
        accountSid: "ACnotreal",
        authToken: "not-a-real-token",
        fromNumber: "+15550000000",
        publicUrl: "https://sms.invalid",
      }),
  },
  {
    platform: "synology_chat",
    make: () =>
      new SynologyChatAdapter({
        botToken: "not-a-real-token",
        incomingUrl:
          "https://nas.invalid/webapi/entry.cgi?api=SYNO.Chat.External&method=chatbot&version=2&token=%22x%22",
      }),
  },
  {
    platform: "teams",
    make: () =>
      new TeamsAdapter({
        clientId: "not-a-real-client",
        clientSecret: "not-a-real-secret",
        tenantId: "not-a-real-tenant",
      }),
  },
  {
    platform: "telegram",
    make: () => new TelegramAdapter({ token: "123456:not-a-real-token" }),
  },
  {
    platform: "tlon_urbit",
    make: () =>
      new TlonUrbitAdapter({
        shipUrl: "https://ship.invalid",
        ship: "~zod",
        code: "lidlut-tabwed-pillex-ridrup",
      }),
  },
  {
    platform: "twitch",
    make: () =>
      new TwitchAdapter({
        accessToken: "not-a-real-token",
        botUserId: "1",
        broadcasterUserIds: ["2"],
      }),
  },
];

describe.each(ADAPTERS)("PlatformAdapter conformance — $platform", ({ platform, make }) => {
  it("declares the platform it is", () => {
    // The routing key. `GatewayRunner` files adapters by it and dispatches outbound on it, so an
    // adapter naming itself wrong is silently unreachable rather than broken.
    expect(make().platform).toBe(platform);
  });

  it("survives disconnect() on an adapter that never connected", async () => {
    // Every consumer's error path calls disconnect on whatever it holds, and a throw there turns
    // a handled failure into an unhandled one. This is also what the runner does when one adapter
    // fails to start: it tears down the rest, including ones that never came up.
    await expect(make().disconnect()).resolves.toBeUndefined();
  }, 30_000);

  it("survives a second disconnect()", async () => {
    const adapter = make();
    await adapter.disconnect();

    await expect(adapter.disconnect()).resolves.toBeUndefined();
  }, 30_000);

  // DELIBERATELY ABSENT: "a stale unsubscribe does not deafen a live subscription".
  //
  // It was written, it passed, and mutation showed it could not fail: the assertion available at
  // this level is `typeof adapter.onInbound(...) === "function"`, which holds whether or not the
  // handler slot was wrongly cleared. Making it real needs a way to deliver an inbound event
  // without a live connection, and only WhatsApp has one — its adapter takes a backend, so a fake
  // backend is a dispatch seam. The other nine own their transports.
  //
  // So the invariant is covered where it can be: textually for all ten in
  // `packages/gateway/tests/lint/adapter-contract.test.ts`, and behaviourally for WhatsApp in
  // `packages/gateway-whatsapp/tests/adapter.test.ts`. Saying that here beats leaving a green
  // test that proves nothing — this file's whole argument is that behaviour beats text, and it
  // would be a poor argument made with an assertion that cannot fail.

  it("returns an unsubscribe that is safe to call twice", async () => {
    // Idempotent teardown again, one level down. A consumer holding an `off()` has no way to know
    // whether something already called it.
    const adapter = make();
    const off = adapter.onInbound(async () => undefined);

    off();

    expect(() => off()).not.toThrow();
  }, 30_000);
});

/** Every adapter but Telegram, the one whose platform send takes images (B-674). */
const REFUSING_ATTACHMENTS = ADAPTERS.filter(({ platform }) => platform !== "telegram");

describe.each(REFUSING_ATTACHMENTS)("attachment refusal — $platform", ({ platform, make }) => {
  it("refuses an outbound with an image as attachments_unsupported with no platform call", async () => {
    // The adapter is never connected, so any platform call would surface as `not_connected` or a
    // network error instead; `attachments_unsupported` is only reachable by refusing first.
    const adapter = make();
    const result = await adapter.sendMessage({
      channel: { id: "1", type: "dm" },
      text: "here it is",
      attachments: [{ kind: "image", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) }],
    });

    expect(adapter.supportsAttachments).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("attachments_unsupported");
    expect(result.error?.message).toContain(platform);
  }, 30_000);

  it("refuses an attachments value with no length as attachments_unsupported (EC-1)", async () => {
    // A JavaScript caller's non-array value: a `> 0` presence check would read it as "no
    // attachments" and send the text alone, dropping whatever the caller meant to attach.
    const adapter = make();
    const out = { channel: { id: "1", type: "dm" }, text: "here it is", attachments: {} };
    const result = await adapter.sendMessage(
      out as unknown as Parameters<typeof adapter.sendMessage>[0],
    );

    expect(result.error?.code).toBe("attachments_unsupported");
  }, 30_000);

  it("answers a null attachments value without throwing and without refusing it", async () => {
    // `null` from a JavaScript caller means no attachments: the send goes on to its usual checks
    // (here `not_connected` or a platform error), never a TypeError and never the refusal.
    const adapter = make();
    const out = { channel: { id: "1", type: "dm" }, text: "here it is", attachments: null };
    const result = await adapter.sendMessage(
      out as unknown as Parameters<typeof adapter.sendMessage>[0],
    );

    expect(result.error?.code).not.toBe("attachments_unsupported");
  }, 30_000);
});
