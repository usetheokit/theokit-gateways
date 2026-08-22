/**
 * The platform registry — the single place that knows which credentials each
 * gateway needs, and what a live test can actually do with them.
 *
 * The `transport` field is the load-bearing one. It is not decoration: it
 * decides whether a round-trip test is possible on a laptop at all.
 *
 * - `connection` — the bot dials OUT and holds the socket open (Telegram
 *   long-polling, Discord's gateway, Slack socket mode, Matrix sync, Mattermost
 *   websocket, IMAP IDLE). Inbound arrives on a connection we opened, so a full
 *   send-then-receive round trip runs anywhere, including CI, with no public
 *   URL and no inbound firewall rule.
 *
 * - `webhook` — the PLATFORM dials in, to a URL it must be able to reach (LINE,
 *   Teams, the WhatsApp Cloud API, and all three SMS providers). Outbound and
 *   credential checks run anywhere; INBOUND cannot, without a publicly
 *   reachable HTTPS endpoint. Those suites say so and skip, rather than
 *   pretending a local server proves anything.
 *
 * Keeping this honest matters more than keeping it short: a suite that silently
 * skips its only meaningful assertion is worse than no suite, because the green
 * tick still reads as coverage.
 */

/** How inbound messages reach the gateway for a given platform. */
export type Transport = "connection" | "webhook";

/** One credential the platform needs, and how a human obtains it. */
export interface CredentialVar {
  /** Environment variable name. */
  readonly name: string;
  /** What it is, in one line. */
  readonly what: string;
  /** Where to get it — a console path, not just a hostname. */
  readonly where: string;
}

export interface PlatformSpec {
  /** Stable id; also the directory name under `tests/`. */
  readonly id: string;
  /** Human label used in test output. */
  readonly label: string;
  /** Workspace package under test. */
  readonly pkg: string;
  readonly transport: Transport;
  /** Credentials without which nothing runs. */
  readonly credentials: readonly CredentialVar[];
  /**
   * Where a live test is allowed to send. Separate from `credentials` because a
   * token proves who you are, not where it is safe to write — and every one of
   * these must point at a throwaway chat, never a real one.
   */
  readonly target: readonly CredentialVar[];
  /** Anything that stops this platform running unattended. */
  readonly caveat?: string;
}

export const PLATFORMS: readonly PlatformSpec[] = [
  {
    id: "telegram",
    label: "Telegram",
    pkg: "@theokit/gateway-telegram",
    transport: "connection",
    credentials: [
      {
        name: "TELEGRAM_BOT_TOKEN",
        what: "Bot token, `<id>:<secret>`",
        where: "Message @BotFather → /newbot (or /token for an existing bot)",
      },
    ],
    target: [
      {
        name: "TELEGRAM_TEST_CHAT_ID",
        what: "Numeric chat id the test may post into",
        where:
          "Create a throwaway group, add the bot, send it one message, then read the id from getUpdates (`pnpm --filter @theokit/gateway-integration discover:telegram`)",
      },
    ],
  },
  {
    id: "discord",
    label: "Discord",
    pkg: "@theokit/gateway-discord",
    transport: "connection",
    credentials: [
      {
        name: "DISCORD_BOT_TOKEN",
        what: "Bot token",
        where: "discord.com/developers/applications → your app → Bot → Reset Token",
      },
    ],
    target: [
      {
        name: "DISCORD_TEST_CHANNEL_ID",
        what: "Channel id the bot may post into",
        where:
          "Create a throwaway server, invite the bot with Send Messages, enable Developer Mode, right-click the channel → Copy Channel ID",
      },
    ],
    caveat:
      "MESSAGE CONTENT is a privileged intent: enable it under Bot → Privileged Gateway Intents, or inbound arrives with empty text.",
  },
  {
    id: "slack",
    label: "Slack",
    pkg: "@theokit/gateway-slack",
    transport: "connection",
    credentials: [
      {
        name: "SLACK_BOT_TOKEN",
        what: "Bot user token, `xoxb-…`",
        where: "api.slack.com/apps → your app → OAuth & Permissions → install to workspace",
      },
      {
        name: "SLACK_APP_TOKEN",
        what: "App-level token, `xapp-…`, scope `connections:write`",
        where: "api.slack.com/apps → your app → Basic Information → App-Level Tokens",
      },
    ],
    target: [
      {
        name: "SLACK_TEST_CHANNEL_ID",
        what: "Channel id, `C…`",
        where: "Create a throwaway channel, invite the bot, then View channel details → bottom",
      },
    ],
    caveat:
      "Socket Mode must be ON for inbound; without it the app token is accepted but no events arrive. " +
      "The inbound probe additionally needs SLACK_TEST_USER_TOKEN — an `xoxp-` token from the app's " +
      "chat:write USER scope — because a message posted with the BOT token is dropped by the loop guard.",
  },
  {
    id: "matrix",
    label: "Matrix",
    pkg: "@theokit/gateway-matrix",
    transport: "connection",
    credentials: [
      {
        name: "MATRIX_HOMESERVER_URL",
        what: "Homeserver base URL — provisioned, not created by hand",
        where: "pnpm --filter @theokit/gateway-integration matrix:up",
      },
      {
        name: "MATRIX_ACCESS_TOKEN",
        what: "Bot access token — provisioned",
        where: "pnpm --filter @theokit/gateway-integration matrix:up",
      },
      {
        name: "MATRIX_USER_ID",
        what: "Bot mxid — provisioned",
        where: "pnpm --filter @theokit/gateway-integration matrix:up",
      },
    ],
    target: [
      {
        name: "MATRIX_TEST_ROOM_ID",
        what: "Room id — provisioned",
        where: "pnpm --filter @theokit/gateway-integration matrix:up",
      },
    ],
    caveat:
      "The only platform here that needs NO credential from anyone: matrix.org answers registration " +
      'with "Only m.login.application_service registrations are allowed", and the other public ' +
      "homeservers have closed registration too, so the suite boots its own server in Docker. That is " +
      "not a downgrade — Matrix is federated and most deployments are self-hosted, so a real " +
      "homeserver IS the platform. It does NOT cover federation between servers, or matrix.org itself.",
  },
  {
    id: "mattermost",
    label: "Mattermost",
    pkg: "@theokit/gateway-mattermost",
    transport: "connection",
    credentials: [
      {
        name: "MATTERMOST_BASE_URL",
        what: "Server base URL — provisioned, not created by hand",
        where: "pnpm --filter @theokit/gateway-integration mattermost:up",
      },
      {
        name: "MATTERMOST_ACCESS_TOKEN",
        what: "Bot personal access token — provisioned",
        where: "pnpm --filter @theokit/gateway-integration mattermost:up",
      },
    ],
    target: [
      {
        name: "MATTERMOST_TEST_CHANNEL_ID",
        what: "Channel id — provisioned",
        where: "pnpm --filter @theokit/gateway-integration mattermost:up",
      },
    ],
    caveat:
      "Self-hosted software, so the suite boots its own server and needs no credential from anyone: " +
      "the first account created through the API on an empty instance becomes system admin, which is " +
      "what lets the whole fixture be built with no console. It does NOT cover Mattermost Cloud, whose " +
      "permission defaults may differ.",
  },
  {
    id: "email",
    label: "Email (IMAP + SMTP)",
    pkg: "@theokit/gateway-email",
    transport: "connection",
    credentials: [
      { name: "EMAIL_ADDRESS", what: "Mailbox the bot owns", where: "A throwaway mailbox" },
      {
        name: "EMAIL_PASSWORD",
        what: "App password, never the account password",
        where: "Gmail: myaccount.google.com/apppasswords (needs 2FA on)",
      },
      { name: "EMAIL_IMAP_HOST", what: "IMAP host", where: "Gmail: imap.gmail.com" },
      { name: "EMAIL_SMTP_HOST", what: "SMTP host", where: "Gmail: smtp.gmail.com" },
    ],
    target: [
      {
        name: "EMAIL_TEST_RECIPIENT",
        what: "Address the test may write to",
        where: "Use the bot's OWN address so the round trip needs one mailbox, not two",
      },
    ],
    caveat:
      "Delivery is not instant; inbound assertions poll with a generous timeout. The inbound " +
      "round trip also needs EMAIL_TEST_SENDER_ADDRESS/PASSWORD — a SECOND mailbox — because the " +
      "adapter drops own-address mail before anything else (EC-1), without which a bot replying " +
      "to its own mail loops forever by email, and that loop outlives the process.",
  },
  {
    id: "line",
    label: "LINE",
    pkg: "@theokit/gateway-line",
    transport: "webhook",
    credentials: [
      {
        name: "LINE_CHANNEL_SECRET",
        what: "Channel secret, used for the inbound HMAC",
        where: "developers.line.biz → your channel → Basic settings",
      },
      {
        name: "LINE_CHANNEL_ACCESS_TOKEN",
        what: "Long-lived channel access token",
        where: "developers.line.biz → your channel → Messaging API → issue token",
      },
    ],
    target: [
      {
        name: "LINE_TEST_USER_ID",
        what: "User id, `U…`, of someone who has added the bot",
        where:
          "Only obtainable from a webhook delivery — see the caveat. Adding the bot as a friend is " +
          "not enough on its own, because nothing in the console shows the id.",
      },
    ],
    caveat:
      "AUTH IS VERIFIED; OUTBOUND IS NOT, and the reason is the platform rather than the code. " +
      "LINE_TEST_USER_ID cannot be obtained without a public HTTPS endpoint: /v2/bot/followers/ids " +
      'answers 403 "Access to this API is not available for your account" on an unverified ' +
      "Official Account, and neither the Developers Console nor the Official Account Manager " +
      "displays the raw id anywhere. Capturing one webhook delivery through a tunnel would settle " +
      "it permanently — the id never changes — and would also unlock inbound for the other three " +
      "webhook platforms. Deliberately not done on 2026-08-17. " +
      "Note also that LINE no longer lets you create a Messaging API channel from the Developers " +
      "Console: it now requires a LINE Official Account (reCAPTCHA + SMS), then enabling the " +
      "Messaging API in the Official Account Manager, which permanently links the provider.",
  },
  {
    id: "teams",
    label: "Microsoft Teams",
    pkg: "@theokit/gateway-teams",
    transport: "webhook",
    credentials: [
      {
        name: "TEAMS_CLIENT_ID",
        what: "App (client) id",
        where: "Azure Portal → App registrations → your app",
      },
      {
        name: "TEAMS_CLIENT_SECRET",
        what: "Client secret",
        where: "Azure Portal → App registrations → Certificates & secrets",
      },
      {
        name: "TEAMS_TENANT_ID",
        what: "Directory (tenant) id",
        where: "Azure Portal → App registrations → Overview",
      },
    ],
    target: [
      {
        name: "TEAMS_TEST_CONVERSATION_ID",
        what: "Conversation id to post into",
        where: "Captured from an inbound activity once the bot is installed in a test team",
      },
    ],
    caveat:
      "Needs an Azure Bot resource with a messaging endpoint. Inbound requires a public HTTPS URL.",
  },
  {
    id: "whatsapp",
    label: "WhatsApp (Cloud API)",
    pkg: "@theokit/gateway-whatsapp",
    transport: "webhook",
    credentials: [
      {
        name: "WHATSAPP_ACCESS_TOKEN",
        what: "Cloud API access token",
        where: "developers.facebook.com → your app → WhatsApp → API Setup",
      },
      {
        name: "WHATSAPP_PHONE_NUMBER_ID",
        what: "Phone number id (not the phone number)",
        where: "Same API Setup page",
      },
    ],
    target: [
      {
        name: "WHATSAPP_TEST_RECIPIENT",
        what: "E.164 number allowed to receive test messages",
        where: "Must be added as a recipient in API Setup while the app is in development mode",
      },
    ],
    caveat:
      "Outside the 24-hour customer service window only approved TEMPLATES send — a free-form text will be rejected by Meta, not by this code. Only the Cloud API backend runs here. The other two — `web`, which drives a browser, and `baileys`, which holds a socket — both pair through a QR scan a human must perform, so neither can run unattended. What that costs is stated rather than hidden: the live suite proves nothing about either, and the manual procedure in `packages/gateway-whatsapp/BAILEYS.md` is the only check they have.",
  },
  {
    id: "sms",
    label: "SMS (Twilio / Plivo / Vonage)",
    pkg: "@theokit/gateway-sms",
    transport: "webhook",
    credentials: [
      {
        name: "SMS_BACKEND",
        what: "Which provider to exercise: twilio | plivo | vonage",
        where: "Your choice; the provider-specific vars below follow from it",
      },
      {
        name: "SMS_ACCOUNT_ID",
        what: "Twilio Account SID / Plivo Auth ID / Vonage API key",
        where: "The provider console dashboard",
      },
      {
        name: "SMS_AUTH_TOKEN",
        what: "Twilio Auth Token / Plivo Auth Token / Vonage API secret",
        where: "The provider console dashboard",
      },
      {
        name: "SMS_FROM_NUMBER",
        what: "E.164 sender number you own",
        where: "The provider console → phone numbers",
      },
    ],
    target: [
      {
        name: "SMS_TEST_RECIPIENT",
        what: "E.164 number the test may text",
        where: "On a trial account this must be a VERIFIED number",
      },
    ],
    caveat: "Every outbound message costs real money. Inbound requires a public HTTPS webhook URL.",
  },
];

export function platformById(id: string): PlatformSpec {
  const found = PLATFORMS.find((p) => p.id === id);
  if (found === undefined) {
    throw new Error(`unknown platform "${id}" — known: ${PLATFORMS.map((p) => p.id).join(", ")}`);
  }
  return found;
}
