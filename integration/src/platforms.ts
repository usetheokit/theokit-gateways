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

/** Separates the three fields of one credential row in the table below. */
const FIELD_SEPARATOR = " :: ";

/** Read one `NAME :: what :: where` row of the table below. */
function cred(row: string): CredentialVar {
  const [name = "", what = "", where = ""] = row.split(FIELD_SEPARATOR);
  return { name, what, where };
}

/**
 * Build one registry entry. Every platform has the same shape, so the table
 * below states only what differs. The package is `@theokit/gateway-<id>` with
 * `_` written as `-`.
 */
function platform(
  id: string,
  label: string,
  transport: Transport,
  credentials: readonly string[],
  target: readonly string[],
  caveat: string | undefined,
  reachableVia: string | undefined,
): PlatformSpec {
  return {
    id,
    label,
    pkg: `@theokit/gateway-${id.replaceAll("_", "-")}`,
    transport,
    credentials: credentials.map(cred),
    target: target.map(cred),
    ...(caveat === undefined ? {} : { caveat }),
    ...(reachableVia === undefined ? {} : { reachableVia }),
  };
}

export const PLATFORMS: readonly PlatformSpec[] = [
  platform(
    "telegram",
    "Telegram",
    "connection",
    [
      "TELEGRAM_BOT_TOKEN :: Bot token, `<id>:<secret>` :: Message @BotFather → /newbot (or /token for an existing bot)",
    ],
    [
      "TELEGRAM_TEST_CHAT_ID :: Numeric chat id the test may post into :: Create a throwaway group, add the bot, send it one message, then read the id from getUpdates (`pnpm --filter @theokit/gateway-integration discover:telegram`)",
    ],
    undefined,
    undefined,
  ),
  platform(
    "discord",
    "Discord",
    "connection",
    [
      "DISCORD_BOT_TOKEN :: Bot token :: discord.com/developers/applications → your app → Bot → Reset Token",
    ],
    [
      "DISCORD_TEST_CHANNEL_ID :: Channel id the bot may post into :: Create a throwaway server, invite the bot with Send Messages, enable Developer Mode, right-click the channel → Copy Channel ID",
    ],
    "MESSAGE CONTENT is a privileged intent: enable it under Bot → Privileged Gateway Intents, or inbound arrives with empty text.",
    undefined,
  ),
  platform(
    "slack",
    "Slack",
    "connection",
    [
      "SLACK_BOT_TOKEN :: Bot user token, `xoxb-…` :: api.slack.com/apps → your app → OAuth & Permissions → install to workspace",
      "SLACK_APP_TOKEN :: App-level token, `xapp-…`, scope `connections:write` :: api.slack.com/apps → your app → Basic Information → App-Level Tokens",
    ],
    [
      "SLACK_TEST_CHANNEL_ID :: Channel id, `C…` :: Create a throwaway channel, invite the bot, then View channel details → bottom",
    ],
    "Socket Mode must be ON for inbound; without it the app token is accepted but no events arrive. The inbound probe additionally needs SLACK_TEST_USER_TOKEN — an `xoxp-` token from the app's chat:write USER scope — because a message posted with the BOT token is dropped by the loop guard.",
    undefined,
  ),
  platform(
    "matrix",
    "Matrix",
    "connection",
    [
      "MATRIX_HOMESERVER_URL :: Homeserver base URL — provisioned, not created by hand :: pnpm --filter @theokit/gateway-integration matrix:up",
      "MATRIX_ACCESS_TOKEN :: Bot access token — provisioned :: pnpm --filter @theokit/gateway-integration matrix:up",
      "MATRIX_USER_ID :: Bot mxid — provisioned :: pnpm --filter @theokit/gateway-integration matrix:up",
    ],
    [
      "MATRIX_TEST_ROOM_ID :: Room id — provisioned :: pnpm --filter @theokit/gateway-integration matrix:up",
    ],
    'The only platform here that needs NO credential from anyone: matrix.org answers registration with "Only m.login.application_service registrations are allowed", and the other public homeservers have closed registration too, so the suite boots its own server in Docker. That is not a downgrade — Matrix is federated and most deployments are self-hosted, so a real homeserver IS the platform. It does NOT cover federation between servers, or matrix.org itself.',
    "MATRIX_HOMESERVER_URL",
  ),
  platform(
    "mattermost",
    "Mattermost",
    "connection",
    [
      "MATTERMOST_BASE_URL :: Server base URL — provisioned, not created by hand :: pnpm --filter @theokit/gateway-integration mattermost:up",
      "MATTERMOST_ACCESS_TOKEN :: Bot personal access token — provisioned :: pnpm --filter @theokit/gateway-integration mattermost:up",
    ],
    [
      "MATTERMOST_TEST_CHANNEL_ID :: Channel id — provisioned :: pnpm --filter @theokit/gateway-integration mattermost:up",
    ],
    "Self-hosted software, so the suite boots its own server and needs no credential from anyone: the first account created through the API on an empty instance becomes system admin, which is what lets the whole fixture be built with no console. It does NOT cover Mattermost Cloud, whose permission defaults may differ.",
    "MATTERMOST_BASE_URL",
  ),
  platform(
    "email",
    "Email (IMAP + SMTP)",
    "connection",
    [
      "EMAIL_ADDRESS :: Mailbox the bot owns :: A throwaway mailbox",
      "EMAIL_PASSWORD :: App password, never the account password :: Gmail: myaccount.google.com/apppasswords (needs 2FA on)",
      "EMAIL_IMAP_HOST :: IMAP host :: Gmail: imap.gmail.com",
      "EMAIL_SMTP_HOST :: SMTP host :: Gmail: smtp.gmail.com",
    ],
    [
      "EMAIL_TEST_RECIPIENT :: Address the test may write to :: Use the bot's OWN address so the round trip needs one mailbox, not two",
    ],
    "Delivery is not instant; inbound assertions poll with a generous timeout. The inbound round trip also needs EMAIL_TEST_SENDER_ADDRESS/PASSWORD — a SECOND mailbox — because the adapter drops own-address mail before anything else (EC-1), without which a bot replying to its own mail loops forever by email, and that loop outlives the process.",
    undefined,
  ),
  platform(
    "signal",
    "Signal",
    "connection",
    [
      "SIGNAL_ACCOUNT :: The bot's Signal number in E.164 form, registered or linked to signal-cli :: `signal-cli -a <number> register` then `verify <code>`, or `signal-cli link` and scan the QR code from a phone's Signal app (Settings → Linked devices)",
    ],
    [
      "SIGNAL_PEER :: E.164 number of a second, throwaway Signal account the test messages and answers from :: Register it in the same signal-cli data directory as SIGNAL_ACCOUNT (`signal-cli -a <peer> register`); the suite drives both accounts, one signal-cli process each",
    ],
    'Needs signal-cli on PATH (the GraalVM native build, or the JVM build with a Java 25 runtime) holding the account\'s keys in its data directory. The suite skips with "signal-cli not on PATH" when the binary is missing.',
    undefined,
  ),
  platform(
    "google-chat",
    "Google Chat",
    "webhook",
    [
      "GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL :: The Chat app's service account, <name>@<project>.iam.gserviceaccount.com :: Google Cloud console → IAM & Admin → Service Accounts",
      "GOOGLE_CHAT_PRIVATE_KEY :: The private_key field of that service account's JSON key; a \\n written as two characters is read as a line break :: Google Cloud console → IAM & Admin → Service Accounts → the account → Keys → Add key → JSON",
      "GOOGLE_CHAT_AUDIENCE :: The HTTP endpoint URL configured for the Chat app, which every inbound token names as its audience :: Google Cloud console → Google Chat API → Configuration → Connection settings → HTTP endpoint URL",
    ],
    [
      "GOOGLE_CHAT_SPACE :: A space name, spaces/<id>, where the app is a member and someone answers the test message :: The space's URL in chat.google.com ends in its id; or the space.name of any inbound event",
    ],
    "Needs a Chat app configured with an HTTP endpoint, in a Google Workspace organisation. Inbound needs INTEGRATION_PUBLIC_URL, a public HTTPS tunnel to this machine, and the app's endpoint URL must equal GOOGLE_CHAT_AUDIENCE.",
    undefined,
  ),
  platform(
    "imessage",
    "iMessage",
    "connection",
    [
      "IMESSAGE_CLI_PATH :: Path to the imsg binary on a Mac signed in to Messages, or to a script that runs `imsg rpc` on that Mac over ssh :: Install imsg (github.com/openclaw/imsg) on macOS 14 or newer, sign in to Messages, and give the terminal Full Disk Access (System Settings → Privacy & Security)",
    ],
    [
      "IMESSAGE_PEER_CHAT_ID :: imsg's numeric chat id of a conversation with a second person or device, who answers the test's message :: `imsg chats` on the Mac lists each chat with its id",
    ],
    'Needs macOS: imsg does not send or receive on Linux. The suite skips with "not macOS" anywhere else, and someone on the peer device must answer the test message.',
    undefined,
  ),
  platform(
    "irc",
    "IRC",
    "connection",
    [
      "IRC_NICK :: The nick the adapter registers, unregistered and at most 16 characters; the peer client takes it plus `pr` :: Choose one no one on the network holds; Libera.Chat needs no account for an unregistered nick",
    ],
    [
      "IRC_HOST :: The network the live suite may write to, over TLS on port 6697; the suite only posts into a channel it creates for the run :: irc.libera.chat, or any network that accepts unregistered nicks over TLS",
    ],
    "The suite joins a fresh #theokit-it-<8 hex> channel, so it writes nowhere anyone reads. A network that requires SASL for new connections, or blocks this host, refuses registration.",
    undefined,
  ),
  platform(
    "feishu-lark",
    "Feishu/Lark",
    "connection",
    [
      "LARK_APP_ID :: The custom app's App ID, `cli_` and 16 hex characters :: Feishu or Lark developer console → your custom app → Credentials & Basic Info",
      "LARK_APP_SECRET :: The same app's App Secret :: Feishu or Lark developer console → your custom app → Credentials & Basic Info",
    ],
    [
      "LARK_DOMAIN :: `feishu` for open.feishu.cn or `lark` for open.larksuite.com :: Whichever console the app was created in",
      "LARK_TEST_CHAT_ID :: A chat the app's bot is in and the suite may write to, `oc_…` :: Add the bot to a throwaway group; the chat id is in the group settings or an event payload",
    ],
    "The app needs the bot capability, the im:message and im:message:send_as_bot scopes, and the long-connection event mode with im.message.receive_v1 subscribed. Inbound needs a person to write in the chat, so the suite checks the outbound half and the connection.",
    undefined,
  ),
  platform(
    "synology-chat",
    "Synology Chat",
    "webhook",
    [
      "SYNOLOGY_CHAT_BOT_TOKEN :: The bot's token, sent with every outgoing callback :: Synology Chat → Integration → Bots → your bot, beside the Outgoing URL",
      "SYNOLOGY_CHAT_INCOMING_URL :: The bot's Incoming URL, `https://<nas>/webapi/entry.cgi?api=SYNO.Chat.External&method=chatbot&version=2&token=…` :: Synology Chat → Integration → Bots → your bot",
    ],
    [
      "SYNOLOGY_CHAT_TEST_USER_ID :: The numeric user id of a throwaway account the bot may write to :: The `user_id` of a callback that account sends the bot, or the bot's user_list",
    ],
    "Inbound is a webhook: the NAS must reach the adapter's Outgoing URL, so the round trip needs INTEGRATION_PUBLIC_URL or a NAS on the same network. The suite records whether the callback came form-encoded or as JSON, and fails if the bot's own reply calls back.",
    undefined,
  ),
  platform(
    "tlon-urbit",
    "Tlon/Urbit",
    "connection",
    [
      "TLON_SHIP_URL :: The bot ship's HTTP base URL :: Tlon hosting shows it for the ship; a self-hosted ship serves on its own host",
      "TLON_SHIP :: The bot ship's name, `~sampel-palnet` :: The ship's own name",
      "TLON_CODE :: The bot ship's web login code :: `+code` in the ship's dojo, or the ship's settings on Tlon hosting",
    ],
    [
      "TLON_PEER_SHIP_URL :: A second, throwaway ship's HTTP base URL, the one that DMs the bot :: As for the bot ship",
      "TLON_PEER_SHIP :: That second ship's name :: As for the bot ship",
      "TLON_PEER_CODE :: That second ship's web login code :: As for the bot ship",
    ],
    "The wire shapes are read from OpenClaw's Tlon extension, not observed against a ship; the live run is what confirms them. The peer must already have a DM open with the bot, or accept the bot's invite.",
    undefined,
  ),
  platform(
    "twitch",
    "Twitch",
    "connection",
    [
      "TWITCH_ACCESS_TOKEN :: The bot account's user access token, with user:read:chat and user:write:chat :: dev.twitch.tv console → your app → an OAuth flow (Authorization Code or Device Code) signed in as the bot account",
      "TWITCH_BOT_USER_ID :: The bot account's numeric user id :: `user_id` in the answer of https://id.twitch.tv/oauth2/validate for the token",
    ],
    [
      "TWITCH_TEST_BROADCASTER_ID :: The numeric user id of a throwaway channel the bot may write in :: A channel you own; its id is in the Helix Get Users answer",
    ],
    "Inbound needs someone chatting in the test channel, so the suite checks the connection, the subscription and one send. Follower-only or other channel modes can drop a bot's message, reported as twitch_message_dropped.",
    undefined,
  ),
  platform(
    "clickclack",
    "ClickClack",
    "connection",
    [
      "CLICKCLACK_BASE_URL :: Base URL of the ClickClack server :: The operator's own ClickClack deployment",
      "CLICKCLACK_TOKEN :: A bot token (ccb_…) with bot:write and realtime:read :: `clickclack admin bot create`",
      "CLICKCLACK_WORKSPACE_ID :: The workspace whose realtime stream is followed :: The ClickClack workspace settings or API",
      "CLICKCLACK_BOT_USER_ID :: The bot's own user id, so its own messages are ignored :: The output of `clickclack admin bot create`",
    ],
    [
      "CLICKCLACK_TEST_CHANNEL_ID :: A channel the bot can post in :: The channel's id in ClickClack",
    ],
    "The suite sends one message, then waits up to 120 s for someone else to write in the channel, so a person must reply during the run. The wire shapes are written from ClickClack's public docs and not yet confirmed against a server.",
    undefined,
  ),
  platform(
    "buzz",
    "Buzz",
    "connection",
    [
      "BUZZ_BASE_URL :: Base URL of the Buzz server :: The operator's own Buzz deployment",
      "BUZZ_TOKEN :: A bot token (bz_…) with bot:write and realtime:read :: The Buzz admin console",
      "BUZZ_WORKSPACE_ID :: The workspace whose realtime stream is followed :: The Buzz workspace settings or API",
      "BUZZ_BOT_USER_ID :: The bot's own user id, so its own messages are ignored :: Shown when the bot is created",
    ],
    ["BUZZ_TEST_CHANNEL_ID :: A channel the bot can post in :: The channel's id in Buzz"],
    "The suite sends one message, then waits up to 120 s for someone else to write in the channel, so a person must reply during the run. The wire shapes are an assumption, since no Buzz spec was available, and not yet confirmed against a server.",
    undefined,
  ),
  platform(
    "zalo",
    "Zalo Official Account",
    "webhook",
    [
      "ZALO_APP_ID :: The Zalo app id :: developers.zalo.me → your app",
      "ZALO_OA_SECRET_KEY :: The OA secret key, used for the inbound signature :: developers.zalo.me → your app → Official Account → Webhook",
      "ZALO_OA_ACCESS_TOKEN :: An OA access token (it expires) :: developers.zalo.me → your app → Official Account → Access token",
    ],
    [
      "ZALO_TEST_USER_ID :: The OA-scoped user id of a follower who messaged the OA in the last 48 hours :: The `sender.id` of one webhook delivery, or the OA's follower list API",
    ],
    "Inbound needs a public HTTPS webhook, so the suite checks the token and one send. Zalo refuses a send to a user outside the 48-hour reply window (zalo_send_failed). The access token expires.",
    undefined,
  ),
  platform(
    "wechat",
    "WeChat Official Account",
    "webhook",
    [
      "WECHAT_APP_ID :: The Official Account AppID :: mp.weixin.qq.com → Settings and Development → Basic Configuration (or a test account at mp.weixin.qq.com/debug/cgi-bin/sandboxinfo)",
      "WECHAT_APP_SECRET :: The AppSecret, exchanged for an access token :: The same page",
      "WECHAT_TOKEN :: The server-URL verification token you chose, used for the inbound signature :: Basic Configuration → Server Configuration",
    ],
    [
      "WECHAT_TEST_OPENID :: The OpenID of a follower who messaged the account in the last 48 hours :: The `FromUserName` of one webhook delivery, or the follower list API",
    ],
    "Inbound needs a public HTTPS server URL, so the suite checks the token exchange and one send. WeChat refuses a customer-service send to a user outside the 48-hour window (wechat_send_failed). The account's IP allow-list must include the machine running the suite.",
    undefined,
  ),
  platform(
    "raft",
    "Raft",
    "connection",
    [
      "RAFT_CLI_PATH :: Path to the Raft CLI, logged in to a Raft account :: Install the CLI (openclaw plugins install @openclaw/raft documents the Raft side) and log in",
    ],
    [
      "RAFT_TEST_CONVERSATION :: The conversation the suite replies to :: The `conversation` (or `from`) of one wake the CLI prints",
    ],
    "The wire contract of the CLI (wake lines, reply command) is an assumption. Receiving needs someone to wake the agent from Raft while the suite waits.",
    undefined,
  ),
  platform(
    "zalo-personal",
    "Zalo Personal",
    "connection",
    [
      "ZALO_PERSONAL_COOKIE :: The account's Zalo web cookie jar, as JSON :: A `zca-js` QR login for the throwaway account, saved by the operator",
      "ZALO_PERSONAL_IMEI :: The device id the session was opened with :: The same `zca-js` login",
      "ZALO_PERSONAL_USER_AGENT :: The user agent the session was opened with :: The same `zca-js` login",
    ],
    [
      "ZALO_PERSONAL_TEST_THREAD_ID :: The uid of a friend of the throwaway account that agrees to receive the test message :: The friend's profile in Zalo, or the `zca-js` friends list",
    ],
    "Unofficial: Zalo may restrict an account that automates, so use a throwaway account. Inbound needs the friend to write, so the suite checks the login, the listener and one send. `zca-js` must be installed beside the adapter.",
    undefined,
  ),
  platform(
    "nostr",
    "Nostr",
    "connection",
    [
      "NOSTR_SECRET_KEY :: The bot's secret key, `nsec1…` or 64 hex characters :: Generate one for the bot (`nak key generate`, or any Nostr client's new account); never reuse a personal key",
    ],
    [
      "NOSTR_RELAY_URL :: A relay the live suite may publish to, `wss://…`, that stores kind 1059 and kind 4 for the two test keys :: A relay you run (for example `nak serve`) or a public relay that accepts unauthenticated writes",
      "NOSTR_PEER_SECRET_KEY :: A second throwaway key the suite writes from, playing the person who DMs the bot :: Generate a second key the same way as the bot's",
    ],
    "Gift wraps are public events encrypted to the two test keys; a public relay keeps them. Use throwaway keys, and prefer a relay you run.",
    undefined,
  ),
  platform(
    "nextcloud-talk",
    "Nextcloud Talk",
    "webhook",
    [
      "NEXTCLOUD_TALK_URL :: Nextcloud server base URL — provisioned, not created by hand :: pnpm --filter @theokit/gateway-integration nextcloud-talk:up",
      "NEXTCLOUD_TALK_BOT_SECRET :: The bot secret, generated per run and never printed — provisioned :: pnpm --filter @theokit/gateway-integration nextcloud-talk:up",
      "NEXTCLOUD_TALK_WEBHOOK_PORT :: The host port the bot's webhook points at, where the suite's adapter listens — provisioned :: pnpm --filter @theokit/gateway-integration nextcloud-talk:up",
      "NEXTCLOUD_TALK_USER_PASSWORD :: The admin password the suite writes in the conversation with — provisioned :: pnpm --filter @theokit/gateway-integration nextcloud-talk:up",
    ],
    [
      "NEXTCLOUD_TALK_ROOM :: Conversation token the bot is attached to — provisioned :: pnpm --filter @theokit/gateway-integration nextcloud-talk:up",
    ],
    "Talk is self-hosted, so a server booted in Docker for the run IS the platform, as for Matrix and Mattermost. The bot's webhook reaches the suite at host.docker.internal, so no public URL is needed; the first boot installs Talk from apps.nextcloud.com. It does NOT cover a hosted Nextcloud behind a proxy, or Talk's federation.",
    "NEXTCLOUD_TALK_URL",
  ),
  platform(
    "line",
    "LINE",
    "webhook",
    [
      "LINE_CHANNEL_SECRET :: Channel secret, used for the inbound HMAC :: developers.line.biz → your channel → Basic settings",
      "LINE_CHANNEL_ACCESS_TOKEN :: Long-lived channel access token :: developers.line.biz → your channel → Messaging API → issue token",
    ],
    [
      "LINE_TEST_USER_ID :: User id, `U…`, of someone who has added the bot :: Only obtainable from a webhook delivery — see the caveat. Adding the bot as a friend is not enough on its own, because nothing in the console shows the id.",
    ],
    'AUTH IS VERIFIED; OUTBOUND IS NOT, and the reason is the platform rather than the code. LINE_TEST_USER_ID cannot be obtained without a public HTTPS endpoint: /v2/bot/followers/ids answers 403 "Access to this API is not available for your account" on an unverified Official Account, and neither the Developers Console nor the Official Account Manager displays the raw id anywhere. Capturing one webhook delivery through a tunnel would settle it permanently — the id never changes — and would also unlock inbound for the other three webhook platforms. Deliberately not done on 2026-08-17. Note also that LINE no longer lets you create a Messaging API channel from the Developers Console: it now requires a LINE Official Account (reCAPTCHA + SMS), then enabling the Messaging API in the Official Account Manager, which permanently links the provider.',
    undefined,
  ),
  platform(
    "teams",
    "Microsoft Teams",
    "webhook",
    [
      "TEAMS_CLIENT_ID :: App (client) id :: Azure Portal → App registrations → your app",
      "TEAMS_CLIENT_SECRET :: Client secret :: Azure Portal → App registrations → Certificates & secrets",
      "TEAMS_TENANT_ID :: Directory (tenant) id :: Azure Portal → App registrations → Overview",
    ],
    [
      "TEAMS_TEST_CONVERSATION_ID :: Conversation id to post into :: Captured from an inbound activity once the bot is installed in a test team",
    ],
    "Needs an Azure Bot resource with a messaging endpoint. Inbound requires a public HTTPS URL.",
    undefined,
  ),
  platform(
    "whatsapp",
    "WhatsApp (Cloud API)",
    "webhook",
    [
      "WHATSAPP_ACCESS_TOKEN :: Cloud API access token :: developers.facebook.com → your app → WhatsApp → API Setup",
      "WHATSAPP_PHONE_NUMBER_ID :: Phone number id (not the phone number) :: Same API Setup page",
    ],
    [
      "WHATSAPP_TEST_RECIPIENT :: E.164 number allowed to receive test messages :: Must be added as a recipient in API Setup while the app is in development mode",
    ],
    "Outside the 24-hour customer service window only approved TEMPLATES send — a free-form text will be rejected by Meta, not by this code. Only the Cloud API backend runs here. The other two — `web`, which drives a browser, and `baileys`, which holds a socket — both pair through a QR scan a human must perform, so neither can run unattended. What that costs is stated rather than hidden: the live suite proves nothing about either, and the manual procedure in `packages/gateway-whatsapp/BAILEYS.md` is the only check they have.",
    undefined,
  ),
  platform(
    "sms",
    "SMS (Twilio / Plivo / Vonage)",
    "webhook",
    [
      "SMS_BACKEND :: Which provider to exercise: twilio | plivo | vonage :: Your choice; the provider-specific vars below follow from it",
      "SMS_ACCOUNT_ID :: Twilio Account SID / Plivo Auth ID / Vonage API key :: The provider console dashboard",
      "SMS_AUTH_TOKEN :: Twilio Auth Token / Plivo Auth Token / Vonage API secret :: The provider console dashboard",
      "SMS_FROM_NUMBER :: E.164 sender number you own :: The provider console → phone numbers",
    ],
    [
      "SMS_TEST_RECIPIENT :: E.164 number the test may text :: On a trial account this must be a VERIFIED number",
    ],
    "Every outbound message costs real money. Inbound requires a public HTTPS webhook URL.",
    undefined,
  ),
];

export function platformById(id: string): PlatformSpec {
  const found = PLATFORMS.find((p) => p.id === id);
  if (found === undefined) {
    throw new Error(`unknown platform "${id}" — known: ${PLATFORMS.map((p) => p.id).join(", ")}`);
  }
  return found;
}
