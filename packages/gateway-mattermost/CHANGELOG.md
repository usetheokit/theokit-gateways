# Changelog

## 0.1.2

### Patch Changes

- 8cbf136: **Every published export now carries documentation.** Forty-seven public symbols shipped with no docblock at all, so a consumer hovering `DiscordAdapter`, `SlackAdapter`, `WhatsAppCloudBackend`, `ThreadStore` or any of the error classes got an empty tooltip. Coverage across the eleven packages went from 71.2% to 100% (163/163), measured over the published declarations rather than the source, because a docblock is not documentation until it survives the build.

  The text says what each symbol is for and what constrains it, not what its name already says. `TelegramAdapter` records that a bot cannot enumerate its chats nor speak into one that has not spoken first. `DiscordAdapter` records that reading message content needs a privileged intent enabled in the developer portal, without which every `event.text` arrives empty and nothing says why. `WhatsAppWebBackend` records that it is unofficial and can get a number banned. `shouldDispatchSyncEvent` records that Matrix replays history on sync, which is why a freshly started bot would otherwise answer every message it can still see.

  **`gateway-slack`'s README documented a type that does not exist.** Its usage example imported `GatewayMessageEvent` from `@theokit/gateway`. That name is an internal alias inside the Discord and Telegram adapters (`MessageEvent as GatewayMessageEvent`), never an export. A reader who copied the example got code that did not compile. It now imports `MessageEvent`, which is what `onInbound` actually hands the handler.

  Two docblocks that attached to nothing were reattached: `acquirePidLock` in `gateway-whatsapp` had its documentation stranded thirty lines above, over a different function, and shipped undocumented as a result.

- b8ef098: **Every package now ships the licence it declares.** All twelve manifests in this repository declare `Apache-2.0`, and the repository had no `LICENSE` file at all — not at the root, and not in any package directory except `gateway-email`. So each published tarball asserted a licence while carrying none of its terms, and §4(a) of that licence requires a copy to travel with the distribution. Worse than a missing file: with no licence text anywhere, everything outside the manifests fell back to default copyright, which grants a recipient nothing.

  The text is now at the repository root and inside every publishable package, byte-identical to the canonical Apache License 2.0 with the appendix filled in (`Copyright 2026 usetheo.dev`). The one pre-existing copy, in `gateway-email`, was replaced along with the rest: it carried the same truncated paragraph 4(d) found across the ecosystem, dropping "reasonable and customary use" from the NOTICE clause — a modified body under an unmodified SPDX identifier.

  **The repository moved to the official `usetheokit` organization.** Existing clones and published URLs keep working through GitHub's permanent redirect; the root manifest now declares `Apache-2.0` explicitly rather than leaving the workspace root silent.

- 5bae032: Six defects that broke real conversations, found by testing the adapters against the live platforms instead of against fakes.

  **LINE — no outbound message was ever delivered.** The adapter called the v9 SDK client with positional arguments while that client takes a single request object, so LINE received an empty request and rejected every send with a 400. Upgrade if you use this adapter at all: nothing it sent reached anyone.

  **Telegram — the bot froze on long replies.** Any message over 4096 characters that began with an unclosed code span (a stray backtick) put the splitter into an infinite loop, hanging the process until it ran out of memory. Long agent answers now split correctly whatever markdown they contain.

  **Mattermost — long messages silently vanished.** The adapter never split anything, so any reply over 16,383 characters was rejected by the server and the user simply saw nothing. Long replies are now split into parts Mattermost accepts.

  **SMS — long messages were rejected from the hundredth part onward.** The `(i/N)` prefix outgrew the space reserved for it, pushing every later part past the provider's limit.

  **Matrix and LINE — `connect()` reported success with an invalid token.** Both now verify the credential with the server before returning `true`, so a wrong token fails at startup instead of silently receiving nothing forever.

  **Email and Teams — the bot could go permanently deaf.** Replacing an inbound handler and then disposing of the previous one removed the new handler as well, and the gateway stopped receiving messages with nothing logged.

  Also: a `pre_inbound` hook that threw put its raw error text into the user's chat, which could expose internal details such as connection strings or tokens. Users now see only which hook failed; the detail goes to the server log, redacted.

  WhatsApp additionally stops opening a second session when `connect()` is called twice, and its group mention filter no longer treats unrelated digits scattered through a message as a mention of the bot.

- **Every adapter now declares its core peer as `>=0.6.0 <1.0.0` instead of `workspace:^`.** The range says what is actually true and tested: these adapters run against the core they ship beside, and nothing is expected to break until the core reaches 1.0.

  `workspace:^` publishes as a caret on the current version, and a caret on a `0.x` version pins the minor — `^0.5.0` admits only `0.5.x`. So every core minor put all ten adapters out of range at once, and changesets correctly reads an out-of-range peer as a breaking change for consumers. On a `0.1.1` package that lands on **1.0.0**.

  Ten packages would have been promoted to 1.0.0 by an artifact of caret semantics on `0.x`, not by anyone deciding they were stable. This repository has two rules against making that claim without evidence — `public-copy.md § 3` and `dogfood-golden-rule.md` — and the evidence directory is empty. The WhatsApp backend added in this same release has never exchanged a message with WhatsApp, which its own `BAILEYS.md` states plainly.

  The range is measured rather than assumed. Across all ten adapters the imported surface from the core is 17 symbols; none was removed or narrowed since the last release, no adapter imports anything introduced in 0.6, and the full suite, typecheck, build and declaration gates run green against 0.6.0. The lower bound is `0.6.0` and not `0.5.0` because 0.6.0 is the core actually exercised — claiming compatibility with a version nothing here compiles against would be the kind of untested assertion the range exists to replace.

  Tightening it is cheap if a future core minor does break an adapter: that is a one-line change in the package that broke, made when there is a reason, instead of ten major bumps every release whether or not anything broke.

## 0.1.1

### Patch Changes

- e926cd9: Align the gateway cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from `^1.9.0` to `^2.18.0` across all 11 packages. The only consumed SDK surface is `Security.redact` (in the gateway core runner) — a stable public API (ADR D68) unchanged across 1.x→2.x — so the alignment is a pin bump, not a migration. Validated: all 11 packages typecheck + build + test green against 2.18.0 (543 tests passed). No dead/unwired surfaces (`no-stubs-no-mocks-no-wired` checklist clean).

## 2.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.3.0
  - @theokit/gateway@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.2.0
  - @theokit/gateway@1.0.0

## [Unreleased]

### Added — `@theokit/gateway-mattermost@0.1.0` (ADRs D397-D404)

- Initial release of the Mattermost platform adapter for `@theokit/gateway`.
- `@mattermost/client@^9.0.0` peer-dep (modern v4 REST + WebSocket gateway).
- `MattermostAdapter` extending `BasePlatformAdapter`:
  - `connect()` initializes Client4 + WebSocketClient; caches bot userId via `getMe()`.
  - `disconnect()` closes WebSocket; idempotent.
  - `sendMessage()` posts to channel; thread replies set `root_id` from `topicId`.
  - `onInbound()` subscribes to WS `posted` events; single-handler replace semantics (EC-H).
- Inbound dispatch pipeline (D403, EC-2):
  1. Drop bot's own posts (loop guard, D275 mirror).
  2. DMs always dispatch.
  3. Channels: respond only when mentioned. **Metadata.mentions array checked FIRST** (unambiguous user-id list from API) before falling back to text-regex with **word-boundary** (`\b@${botUsername}\b` — prevents `@theory` matching `@theo`).
- Channel-type mapping (D402): `D` → `dm`, `G`/`O`/`P` → `group`. Original Mattermost type preserved in `event.mattermost.channelType`.
- Personal Access Token auth (D401). OAuth deferred to v0.2.
- File uploads (D404), Slash commands, and ephemeral messages deferred to v0.2 — caller can access `adapter.getClient()` (REST) for escape-hatch use.
