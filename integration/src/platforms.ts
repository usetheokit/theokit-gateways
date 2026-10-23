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
  /**
   * Env var holding a base URL that must ANSWER for this platform to run.
   *
   * Only for platforms whose server we provision ourselves: there, the credentials are written by
   * the bootstrap script, so their presence proves the container was once up rather than that it is
   * up now. A platform hosted by someone else declares nothing here — its server being down is not
   * a local precondition anyone can act on.
   */
  readonly reachableVia?: string;
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
    reachableVia: "MATRIX_HOMESERVER_URL",
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
    reachableVia: "MATTERMOST_BASE_URL",
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
    id: "signal",
    label: "Signal",
    pkg: "@theokit/gateway-signal",
    transport: "connection",
    credentials: [
      {
        name: "SIGNAL_ACCOUNT",
        what: "The bot's Signal number in E.164 form, registered or linked to signal-cli",
        where:
          "`signal-cli -a <number> register` then `verify <code>`, or `signal-cli link` and scan the QR code from a phone's Signal app (Settings → Linked devices)",
      },
    ],
    target: [
      {
        name: "SIGNAL_PEER",
        what: "E.164 number of a second, throwaway Signal account the test messages and answers from",
        where:
          "Register it in the same signal-cli data directory as SIGNAL_ACCOUNT (`signal-cli -a <peer> register`); the suite drives both accounts, one signal-cli process each",
      },
    ],
    caveat:
      'Needs signal-cli on PATH (the GraalVM native build, or the JVM build with a Java 25 runtime) holding the account\'s keys in its data directory. The suite skips with "signal-cli not on PATH" when the binary is missing.',
  },
  {
    id: "google-chat",
    label: "Google Chat",
    pkg: "@theokit/gateway-google-chat",
    transport: "webhook",
    credentials: [
      {
        name: "GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL",
        what: "The Chat app's service account, <name>@<project>.iam.gserviceaccount.com",
        where: "Google Cloud console → IAM & Admin → Service Accounts",
      },
      {
        name: "GOOGLE_CHAT_PRIVATE_KEY",
        what: "The private_key field of that service account's JSON key; a \\n written as two characters is read as a line break",
        where:
          "Google Cloud console → IAM & Admin → Service Accounts → the account → Keys → Add key → JSON",
      },
      {
        name: "GOOGLE_CHAT_AUDIENCE",
        what: "The HTTP endpoint URL configured for the Chat app, which every inbound token names as its audience",
        where:
          "Google Cloud console → Google Chat API → Configuration → Connection settings → HTTP endpoint URL",
      },
    ],
    target: [
      {
        name: "GOOGLE_CHAT_SPACE",
        what: "A space name, spaces/<id>, where the app is a member and someone answers the test message",
        where:
          "The space's URL in chat.google.com ends in its id; or the space.name of any inbound event",
      },
    ],
    caveat:
      "Needs a Chat app configured with an HTTP endpoint, in a Google Workspace organisation. Inbound needs INTEGRATION_PUBLIC_URL, a public HTTPS tunnel to this machine, and the app's endpoint URL must equal GOOGLE_CHAT_AUDIENCE.",
  },
  {
    id: "imessage",
    label: "iMessage",
    pkg: "@theokit/gateway-imessage",
    transport: "connection",
    credentials: [
      {
        name: "IMESSAGE_CLI_PATH",
        what: "Path to the imsg binary on a Mac signed in to Messages, or to a script that runs `imsg rpc` on that Mac over ssh",
        where:
          "Install imsg (github.com/openclaw/imsg) on macOS 14 or newer, sign in to Messages, and give the terminal Full Disk Access (System Settings → Privacy & Security)",
      },
    ],
    target: [
      {
        name: "IMESSAGE_PEER_CHAT_ID",
        what: "imsg's numeric chat id of a conversation with a second person or device, who answers the test's message",
        where: "`imsg chats` on the Mac lists each chat with its id",
      },
    ],
    caveat:
      'Needs macOS: imsg does not send or receive on Linux. The suite skips with "not macOS" anywhere else, and someone on the peer device must answer the test message.',
  },
  {
    id: "irc",
    label: "IRC",
    pkg: "@theokit/gateway-irc",
    transport: "connection",
    credentials: [
      {
        name: "IRC_NICK",
        what: "The nick the adapter registers, unregistered and at most 16 characters; the peer client takes it plus `pr`",
        where:
          "Choose one no one on the network holds; Libera.Chat needs no account for an unregistered nick",
      },
    ],
    target: [
      {
        name: "IRC_HOST",
        what: "The network the live suite may write to, over TLS on port 6697; the suite only posts into a channel it creates for the run",
        where: "irc.libera.chat, or any network that accepts unregistered nicks over TLS",
      },
    ],
    caveat:
      "The suite joins a fresh #theokit-it-<8 hex> channel, so it writes nowhere anyone reads. A network that requires SASL for new connections, or blocks this host, refuses registration.",
  },
  {
    id: "feishu-lark",
    label: "Feishu/Lark",
    pkg: "@theokit/gateway-feishu-lark",
    transport: "connection",
    credentials: [
      {
        name: "LARK_APP_ID",
        what: "The custom app's App ID, `cli_` and 16 hex characters",
        where: "Feishu or Lark developer console → your custom app → Credentials & Basic Info",
      },
      {
        name: "LARK_APP_SECRET",
        what: "The same app's App Secret",
        where: "Feishu or Lark developer console → your custom app → Credentials & Basic Info",
      },
    ],
    target: [
      {
        name: "LARK_DOMAIN",
        what: "`feishu` for open.feishu.cn or `lark` for open.larksuite.com",
        where: "Whichever console the app was created in",
      },
      {
        name: "LARK_TEST_CHAT_ID",
        what: "A chat the app's bot is in and the suite may write to, `oc_…`",
        where:
          "Add the bot to a throwaway group; the chat id is in the group settings or an event payload",
      },
    ],
    caveat:
      "The app needs the bot capability, the im:message and im:message:send_as_bot scopes, and the long-connection event mode with im.message.receive_v1 subscribed. Inbound needs a person to write in the chat, so the suite checks the outbound half and the connection.",
  },
  {
    id: "synology-chat",
    label: "Synology Chat",
    pkg: "@theokit/gateway-synology-chat",
    transport: "webhook",
    credentials: [
      {
        name: "SYNOLOGY_CHAT_BOT_TOKEN",
        what: "The bot's token, sent with every outgoing callback",
        where: "Synology Chat → Integration → Bots → your bot, beside the Outgoing URL",
      },
      {
        name: "SYNOLOGY_CHAT_INCOMING_URL",
        what: "The bot's Incoming URL, `https://<nas>/webapi/entry.cgi?api=SYNO.Chat.External&method=chatbot&version=2&token=…`",
        where: "Synology Chat → Integration → Bots → your bot",
      },
    ],
    target: [
      {
        name: "SYNOLOGY_CHAT_TEST_USER_ID",
        what: "The numeric user id of a throwaway account the bot may write to",
        where: "The `user_id` of a callback that account sends the bot, or the bot's user_list",
      },
    ],
    caveat:
      "Inbound is a webhook: the NAS must reach the adapter's Outgoing URL, so the round trip needs INTEGRATION_PUBLIC_URL or a NAS on the same network. The suite records whether the callback came form-encoded or as JSON, and fails if the bot's own reply calls back.",
  },
  {
    id: "tlon-urbit",
    label: "Tlon/Urbit",
    pkg: "@theokit/gateway-tlon-urbit",
    transport: "connection",
    credentials: [
      {
        name: "TLON_SHIP_URL",
        what: "The bot ship's HTTP base URL",
        where: "Tlon hosting shows it for the ship; a self-hosted ship serves on its own host",
      },
      {
        name: "TLON_SHIP",
        what: "The bot ship's name, `~sampel-palnet`",
        where: "The ship's own name",
      },
      {
        name: "TLON_CODE",
        what: "The bot ship's web login code",
        where: "`+code` in the ship's dojo, or the ship's settings on Tlon hosting",
      },
    ],
    target: [
      {
        name: "TLON_PEER_SHIP_URL",
        what: "A second, throwaway ship's HTTP base URL, the one that DMs the bot",
        where: "As for the bot ship",
      },
      {
        name: "TLON_PEER_SHIP",
        what: "That second ship's name",
        where: "As for the bot ship",
      },
      {
        name: "TLON_PEER_CODE",
        what: "That second ship's web login code",
        where: "As for the bot ship",
      },
    ],
    caveat:
      "The wire shapes are read from OpenClaw's Tlon extension, not observed against a ship; the live run is what confirms them. The peer must already have a DM open with the bot, or accept the bot's invite.",
  },
  {
    id: "nostr",
    label: "Nostr",
    pkg: "@theokit/gateway-nostr",
    transport: "connection",
    credentials: [
      {
        name: "NOSTR_SECRET_KEY",
        what: "The bot's secret key, `nsec1…` or 64 hex characters",
        where:
          "Generate one for the bot (`nak key generate`, or any Nostr client's new account); never reuse a personal key",
      },
    ],
    target: [
      {
        name: "NOSTR_RELAY_URL",
        what: "A relay the live suite may publish to, `wss://…`, that stores kind 1059 and kind 4 for the two test keys",
        where:
          "A relay you run (for example `nak serve`) or a public relay that accepts unauthenticated writes",
      },
      {
        name: "NOSTR_PEER_SECRET_KEY",
        what: "A second throwaway key the suite writes from, playing the person who DMs the bot",
        where: "Generate a second key the same way as the bot's",
      },
    ],
    caveat:
      "Gift wraps are public events encrypted to the two test keys; a public relay keeps them. Use throwaway keys, and prefer a relay you run.",
  },
  {
    id: "nextcloud-talk",
    reachableVia: "NEXTCLOUD_TALK_URL",
    label: "Nextcloud Talk",
    pkg: "@theokit/gateway-nextcloud-talk",
    transport: "webhook",
    credentials: [
      {
        name: "NEXTCLOUD_TALK_URL",
        what: "Nextcloud server base URL — provisioned, not created by hand",
        where: "pnpm --filter @theokit/gateway-integration nextcloud-talk:up",
      },
      {
        name: "NEXTCLOUD_TALK_BOT_SECRET",
        what: "The bot secret, generated per run and never printed — provisioned",
        where: "pnpm --filter @theokit/gateway-integration nextcloud-talk:up",
      },
      {
        name: "NEXTCLOUD_TALK_WEBHOOK_PORT",
        what: "The host port the bot's webhook points at, where the suite's adapter listens — provisioned",
        where: "pnpm --filter @theokit/gateway-integration nextcloud-talk:up",
      },
      {
        name: "NEXTCLOUD_TALK_USER_PASSWORD",
        what: "The admin password the suite writes in the conversation with — provisioned",
        where: "pnpm --filter @theokit/gateway-integration nextcloud-talk:up",
      },
    ],
    target: [
      {
        name: "NEXTCLOUD_TALK_ROOM",
        what: "Conversation token the bot is attached to — provisioned",
        where: "pnpm --filter @theokit/gateway-integration nextcloud-talk:up",
      },
    ],
    caveat:
      "Talk is self-hosted, so a server booted in Docker for the run IS the platform, as for Matrix " +
      "and Mattermost. The bot's webhook reaches the suite at host.docker.internal, so no public " +
      "URL is needed; the first boot installs Talk from apps.nextcloud.com. It does NOT cover a " +
      "hosted Nextcloud behind a proxy, or Talk's federation.",
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
