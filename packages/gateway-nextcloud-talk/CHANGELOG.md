# @theokit/gateway-nextcloud-talk

## 0.4.0

### Minor Changes

- ec85246: Map HTTP send failures with `sendErrorFromHttp`: 429 is now `rate_limit` with `retryAfterMs`, 401 `auth_failed`, 403 `permission_denied`, 5xx `server_error`, and a rejected fetch `network_error`. The old codes move to `platformCode`: `google_chat_auth_error`, `google_chat_http_error`, `talk_unauthorized`, `talk_bad_request`, `talk_http_error`, `synology_api_error` and `twitch_api_error` (Synology body-level errors are now `platform_error`). Raises the `@theokit/gateway` peer floor to 0.25.0.

### Patch Changes

- bdf81aa: Verify webhook signatures with the core `verifyHmac`, and compare the WhatsApp verify token with `safeEqualString`; an empty expected verify token now never matches. Raises the `@theokit/gateway` peer floor to 0.26.0.
- 4853f1b: `splitForTalk` now calls core `splitKeepingRows` with the code-point unit instead of its own copy, and the `@theokit/gateway` peer floor rises from 0.23.0 to 0.26.0. Core cuts at grapheme boundaries, the old copy cut at code points: a part that used to end inside a ZWJ emoji or a flag now ends before it.
- ff62df5: Share the split-tables test cases of the three adapters in one module under `shared/`. Tests only; no change to the published code.

## 0.3.0

### Minor Changes

- be678d9: The `nextcloudTalkChannel` and `synologyChatChannel` descriptors now declare `transport: "webhook"` with a `webhook.handle`, so a host mounts them with `createWebhookHandler`. Nextcloud Talk checks the signature headers over the raw body; Synology Chat checks the outgoing-webhook token in the form body. Statuses match the packages' own routes, and the Express listeners are unchanged.
- 35d9d91: Export a `ChannelDescriptor` with environment variable bindings: `ircChannel`, `nextcloudTalkChannel` and `nostrChannel`, for use with `createChannels` and `configFromEnv`. The `@theokit/gateway` peer floor is `>=0.23.0`, the release that adds the `readNumber`, `readList` and `readBooleanString` readers the descriptors call.

### Patch Changes

- fc94485: The email, IRC, Matrix, Nextcloud Talk and Signal channel descriptors build their configuration fields with the shared `field` helper, and email and Matrix read their env-string numbers and booleans through one shared reader instead of two copies. The descriptors and the values they accept are unchanged.

## 0.2.0

### Minor Changes

- d4f0bc5: Report `capabilities.maxMessageChars` from the splitter's limit. IRC leaves it undefined because its limit is in bytes. None of these adapters produces thread events, so `threads` stays `false`.

## 0.1.0

### Minor Changes

- d87e26b: Add `@theokit/gateway-nextcloud-talk`, a Nextcloud Talk bot adapter.

  `@theokit/gateway-nextcloud-talk` (first release) exports `NextcloudTalkAdapter`, which runs as a
  Talk bot. Its webhook route (default port 3000, path `/nextcloud-talk`, or the caller's own Express app
  given as `app`) accepts a request only when `x-nextcloud-talk-signature` is the hex
  HMAC-SHA256 of `x-nextcloud-talk-random` followed by the raw body under the bot secret, compared
  in constant time, and answers 401 otherwise. A body over 1 MiB is refused with 413 and a JSON error
  body before it is held. A port another listener holds makes `connect()` answer `false`. A message a person wrote becomes a
  `NextcloudTalkMessageEvent`; a `Join` or a bot's message does not. `sendMessage` posts as the bot
  with its own signed random, returns the `referenceId` it sent as `messageId`, and sends a text
  over 32000 code points as consecutive messages. `connect()` requires the server's `bots-v1`
  feature and returns `false`, never a throw, when the server cannot be read, lacks it, or passes
  `connectTimeoutMs`. A `connect()` made while another is pending shares its answer, and a
  `disconnect()` made while one is pending wins: the connect answers `false` and leaves no listener, and a `connect()` made after that
  `disconnect()` starts a fresh session instead of inheriting the `false`.
  The constructor throws on a secret outside 40 to 128 characters.
  `splitForTalk` and `TALK_MAX_LENGTH` (the splitter), `talkSignature` and `verifyTalkSignature`, and
  `talkBodyToMessageEvent` are exported. The package has no runtime dependencies (`express` is a
  peer) and requires `@theokit/gateway` 0.12.0 or later, the first version with the
  `nextcloud_talk` key.

### Patch Changes

- e890905: Refuse an outbound that carries images with `attachments_unsupported`, making no platform call,
  instead of sending its text and dropping the images. The same refusal answers an outbound with
  attachments on every adapter that sends text only.
- 7ed3df1: `splitForTalk` no longer cuts a Markdown table row in two at a part boundary. When a cut would
  fall inside a row that fits in one part, the part ends before that row and the row starts the next
  part. A row longer than a part is still cut by length. Every character is kept, every part stays
  within the limit in code points, and text with no table row splits exactly as before. Two rows
  that each fill a part exactly arrive as three parts, the second holding only the line ending
  between them.

  No export, signature, dependency or peer range changes.
