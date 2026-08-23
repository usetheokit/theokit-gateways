# Changelog

## 0.5.1

### Patch Changes

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

## 0.5.0

### Minor Changes

- Architecture-hardening (roadmap M0–M3): three new public primitives on the core barrel, plus a hook-engine relocation. No breaking changes.

  - `chunkText(text, options)` — transport-agnostic, boundary-preferring text chunker. Single-sources the message-splitting logic the platform adapters share; reproduces the Slack-family (fixed window, space boundary, UTF-16 surrogate guard) and Telegram-family (soft window, newline-only) algorithms via options. Validates inputs (positive-integer `limit`, `safeLimit <= limit`) and throws `RangeError` on misuse (fail-fast — no infinite loop).
  - `chunkByGrapheme(text, options)` — grapheme-cluster-safe (`Intl.Segmenter`) chunker shared by the LINE/SMS adapters; never severs an emoji, regional-indicator pair, or combining sequence.
  - `GatewayConfigurationError` base + `GatewayConfigurationErrorOptions` — shared base for per-adapter `ConfigurationError` classes.
  - `HookExecutor` moved from `hooks/types.ts` to `hooks/executor.ts` (public API byte-identical; re-exported unchanged from the barrel).

## 0.4.1

### Patch Changes

- e926cd9: Align the gateway cluster to the hardened `@theokit/sdk` 2.18.0 Harness (ecosystem M6). Bumped the `@theokit/sdk` peer + dev dependency from `^1.9.0` to `^2.18.0` across all 11 packages. The only consumed SDK surface is `Security.redact` (in the gateway core runner) — a stable public API (ADR D68) unchanged across 1.x→2.x — so the alignment is a pin bump, not a migration. Validated: all 11 packages typecheck + build + test green against 2.18.0 (543 tests passed). No dead/unwired surfaces (`no-stubs-no-mocks-no-wired` checklist clean).

## [Unreleased]

### Changed

- **Documentation only:** added `src/README.md` documenting the 6 single-file sub-folder cluster (`adapter/`, `delivery/`, `hooks/`, `runner/`, `session/`, `types/`) as intentional bounded future-extensibility scaffold (T10.2 of plan `arch-review-fixes-2026-06-06`; FO#4 of 2026-06-06 architecture audit). Rationale + ADR cross-references (D170-D177) + 12-month re-evaluation trigger documented. No code change.

## 2.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.3.0

## 1.0.0

### Patch Changes

- Updated dependencies
  - @theokit/sdk@1.2.0

## [Unreleased]

### Added — Tier 1 Expansion variants (T0.1, ADRs D389/D397/D405/D413)

- `SMSMessageEvent` variant added to the `MessageEvent` discriminated union. Required for `@theokit/gateway-sms`.
- `MattermostMessageEvent` variant added to the `MessageEvent` discriminated union. Required for `@theokit/gateway-mattermost`.
- `LineMessageEvent` variant added to the `MessageEvent` discriminated union. Required for `@theokit/gateway-line`.
- `MatrixMessageEvent` variant added to the `MessageEvent` discriminated union. Required for `@theokit/gateway-matrix`.
- `PlatformName` union opened to include `"sms" | "mattermost" | "line" | "matrix"` (10 platforms total).

### Changed

- Backward-compatible additive change — existing adapters / consumers continue to compile. The single `exhaustive switch` test was updated to cover the new 4 cases (EC-5 absorbed).

## [0.4.0] - 2026-05-24

### Added

- `EmailMessageEvent` variant added to the `MessageEvent` discriminated union (ADR D339). Required for `@theokit/gateway-email`.
- `PlatformName` union opened to include `"email"`.

### Changed

- Minor version bump (additive change — existing adapters / consumers unaffected).

## [0.3.0] - 2026-05-23

### Added

- `TeamsMessageEvent` variant added to the `MessageEvent` discriminated union (ADR D325). Required for `@theokit/gateway-teams`.
- `PlatformName` union opened to include `"teams"`.

### Changed

- Minor version bump (additive change — existing adapters / consumers unaffected).

## [0.2.0] - 2026-05-23

### Added

- `WhatsAppMessageEvent` variant added to the `MessageEvent` discriminated union (ADR D308). Required for `@theokit/gateway-whatsapp`.
- `PlatformName` union opened to include `"whatsapp"`.

### Changed

- Minor version bump (additive change — existing adapters / consumers unaffected).

## [0.1.0] — 2026-05-20

### Added

- Initial release. Core gateway primitives for `@theokit/sdk`.
- `BasePlatformAdapter` abstract class — contract for transport adapters (ADR D172).
- `MessageEvent` discriminated union with `platform` discriminator (ADR D173).
- `GatewayRunner` — top-level orchestrator with drain timeout on `stop()` (EC-E).
- `SessionRouter` — pure routing strategy; composes `Agent.resume` (ADR D174).
- `DeliveryRouter` — outbound dispatch; composes `Cron` (ADR D175).
- `HookExecutor` with `pre_inbound` / `post_outbound` / `on_error` (ADRs D176, D177).
- `ctx.reply` auto-routes to the adapter matching `event.platform` (EC-G).
- `{ block: true, message }` from `pre_inbound` triggers auto-reply before short-circuit (EC-D).
- All runner error log paths wrap text in `Security.redact(...)` from `@theokit/sdk` (EC-F, ADR D68).
