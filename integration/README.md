# `@theokit/gateway-integration`

Live tests. Real credentials, real APIs, real messages.

The unit suites in `packages/*/tests` prove this code does what we think against
fakes. They cannot prove the thing that actually breaks in production: that the
contract we coded against is still the contract the platform serves. A fake
agrees with whoever wrote it. Only LINE can tell you that `replyMessage` now
takes one object instead of two arguments — which is exactly how every outbound
LINE message shipped broken while eight unit tests stayed green.

That is what lives here, and nothing else. These suites do not re-test splitting
or filtering over the wire; they test **auth reaches the provider**, **our
payload shape is accepted**, and **a real error maps to the error we claim to
return**.

## These are integration tests, whatever the folder is called

Worth being exact, because the name claims more than most of the tests deliver.
By the pyramid in `rules/testing.md`, integration is "clients against APIs" and
E2E is "critical flows from the user's point of view". Every **per-platform**
suite here constructs **one adapter** and drives it against **one real API** —
the first definition, literally. None of them imports `@theokit/gateway`.

So read a green per-platform run as: *every adapter still speaks its platform's
current protocol*. That is what those suites prove, and it is not the same thing
as proving the gateway works.

`tests/gateway-e2e.test.ts` is the one that earns the other name, and the only
file here that imports `@theokit/gateway`. It drives the flow a consumer actually
builds — a real person posts, the adapter normalises, `GatewayRunner` runs the
hook chain, the handler answers through `ctx.reply()`, and the reply is read back
from the room by the sender. It runs on Matrix because `pnpm matrix:up` boots a
homeserver in Docker, so it needs no credential from anybody and costs nothing.

### Which core capabilities are proven live

The e2e suite drives, over a real homeserver: the full inbound→handler→reply
round trip; a `pre_inbound` hook observing, and a second one blocking with a
message that reaches the room; a handler that **throws**, after which the next
message is still answered; `on_error` receiving that failure; `post_outbound`
receiving the platform's real acknowledgement; `runner.command()` slash dispatch;
`stop()` draining a handler still running when it is called; a stopped runner
refusing to restart; and `DeliveryRouter` delivering on the outbound-only path
that never begins with an inbound event.

What is deliberately **not** driven live is written down rather than left to be
noticed: `readiness.test.ts` fails when a runtime export of `@theokit/gateway`
is neither named by a live test nor listed with a reason. Today the reasons are
all the same one — `chunkText`, `chunkByGrapheme`, `defaultStrategy` and
`SessionRouter` are pure functions, so a live run would prove nothing a unit test
does not. (The *splitting* they perform is still proven over the wire, by the
five adapter suites that send past their platform's cap.)

That gate exists because the honest number was invisible: measured 2026-08-22,
this package drove **one** of the core's ten runtime exports, and nothing said so.
`post_outbound` could not have been observed live even in principle — it had no
production caller at all until #38.

---

## Running

```bash
cp integration/.env.example integration/.env     # then fill in what you have
pnpm integration                         # or: pnpm --filter @theokit/gateway-integration integration
pnpm integration:readiness               # what is configured, what each gap needs
```

Nothing runs without `INTEGRATION_LIVE=1`. A stray `pnpm integration` cannot spend money or post
into a chat.

**`pnpm test` never runs these.** This package deliberately has no `test`
script, so `pnpm -r run test` — the command CI runs on every push — cannot reach
it. Live tests belong on a schedule and on demand, not on every pull request:
they are slow, they cost money, and a provider's bad afternoon is not a reason to
turn someone's PR red.

---

## What each platform needs

`pnpm integration:readiness` prints this from the registry, per platform, with the
console path to create each credential. It is generated, so it cannot drift from
what the code reads.

`.env.example` is generated from the same source:

```bash
pnpm --filter @theokit/gateway-integration env:example
```

---

## Two kinds of platform, and why it decides what is testable

This is the distinction the folder layout and the harness are built around.

**Connection-based** — Telegram, Discord, Slack, Matrix, Mattermost, Email.
The bot dials out and holds the socket open (long-polling, a gateway websocket,
socket mode, sync, IMAP IDLE). Inbound arrives on a connection *we* opened, so a
full send-then-receive round trip runs anywhere, including CI, with no public URL
and no firewall change.

**Webhook-based** — LINE, Teams, WhatsApp Cloud, SMS.
The *platform* dials in, to a URL it has to be able to reach. Outbound and
credential checks run anywhere. **Inbound cannot**, without a publicly reachable
HTTPS endpoint. Those suites skip and say so, rather than serving themselves a
request locally and calling it coverage — a locally-served request proves the
test's own fixture works and nothing about the platform.

To run the webhook inbound suites, point `INTEGRATION_PUBLIC_URL` at a tunnel that
reaches this process (`ngrok http 3000`, `cloudflared tunnel`), and register that
URL in the provider console.

`pnpm capture:line`, which captures `LINE_TEST_USER_ID` from one delivery, needs
`cloudflared` **already installed** — `brew install cloudflared`, Cloudflare's apt
repository, or `winget install Cloudflare.cloudflared`. It used to download the
binary itself and run it unverified (#35); a package manager checks a signature,
and this script runs on the machine holding every credential in `.env`. Point
`CLOUDFLARED_PATH` at it if it lives somewhere unusual.

---

## Running with nobody watching

Per run: **zero human action**, for every platform. That is the target and it is
reachable.

One-time provisioning: **unavoidable**, and it is the same cost as creating the
token in the first place. Nobody can automate "prove you own this phone number"
away — that is what the check is for.

The interesting case is Telegram inbound, because two platform rules bite at
once:

- A bot cannot enumerate its chats. There is no API for it.
- A bot cannot speak into a chat that has not spoken to it first. Both rules
  exist to stop bots cold-messaging people, and neither has a workaround.

So the chat id cannot come from the bot token. What CAN be changed is the
identity doing the asking:

```bash
pnpm --filter @theokit/gateway-integration session:telegram      # once, needs a phone code
pnpm --filter @theokit/gateway-integration bootstrap:telegram    # unattended from here on
```

`session:telegram` mints an MTProto session string for a throwaway USER account.
`bootstrap:telegram` then uses it to create the test group, add the bot, post the
first message, and write `TELEGRAM_TEST_CHAT_ID` into `.env` — no console, no
tapping, no group made by hand.

A user account is required and a second bot will not do. Telegram's Bot FAQ:
*"bots will not be able to see messages from other bots regardless of mode."* A
second bot would post successfully and the gateway would never see it, so an
inbound suite driven that way cannot pass however long it waits. The first
version of this package got that wrong.

The session string is **full access to that account**, not a scoped token. Use a
throwaway account, and treat the value like a password.

**Decided 2026-08-17: Telegram inbound stays uncovered.** A session string in CI
means anyone with repository access has the account behind it. Against that, the
assertion it buys is one inbound message on a platform whose authentication and
outbound are already verified. The gap is the cheaper side of that trade, so the
suite skips with a comment saying it is a decision rather than an oversight.
Revisit it with a throwaway account, never a personal one.

**Enforced 2026-08-22.** Until then the decision lived only in comments, while
`.github/workflows/integration.yml` declared `TELEGRAM_TEST_SESSION` and piped it
into both steps. The only thing standing between that comment and an account
credential in CI was nobody having filled the secret in — which is a habit, not a
control. The workflow no longer references the variable, so restoring the
capability is a deliberate three-line edit that shows up in a diff.

---

## Layout

```
integration/
├── src/
│   ├── platforms.ts     the registry — every credential, what it is, where to get it
│   ├── credentials.ts   .env locally, repository secrets in CI; identical names
│   ├── harness.ts       describeLive() — skips with a NAMED reason, never silently
│   ├── line-capture.ts  who may set LINE_TEST_USER_ID: verify HMAC, then parse
│   ├── tunnel-binary.ts finds cloudflared; never downloads one
│   └── env-file.ts      writes one variable into .env without reformatting it
├── tests/
│   ├── readiness.test.ts   always runs; reports the gap across all ten
│   ├── unit/               offline units for the modules above; run on every PR
│   └── <platform>/         one directory per registry id
└── scripts/
    ├── env-example.ts        regenerates .env.example from the registry
    ├── capture-line-user.ts  captures LINE_TEST_USER_ID from one signed delivery
    └── discover-telegram.ts  finds a chat id the bot can see
```

One directory per platform id, and `readiness.test.ts` fails if those two ever
disagree — a platform in the registry with no suite, or a suite for a platform
nobody registered. `tests/unit/` is the single named exception, listed in that
test rather than pattern-matched.

**`tests/unit/` runs on every PR, unlike everything else here.** Those modules
decide whether a webhook delivery may write to `.env` and which binary the
capture script executes; they touch no network, so gating them on a nightly live
run would be leaving security logic unverified for a day at a time. They hang off
`test:unit` — a name `pnpm -r run test` cannot reach, which is what keeps the
no-`test`-script invariant intact.

---

## Rules these tests follow

**Skips are loud.** Vitest reports a skipped test and a passing test with the
same absence of red. Every skip here names the exact variable that was missing,
because "9 skipped, 1 passed" otherwise reads at a glance like ten platforms
passing.

**And in CI, skips are not allowed to be silent.** Naming the gap is enough for a
human reading output; it is not enough for a gate. This workflow gates release,
so `INTEGRATION_REQUIRE_PLATFORMS` lists the platforms a run is expected to
actually exercise, and the readiness suite FAILS when one of them is not
configured. Without it, a secret that gets deleted, renamed or emptied turns its
platform off and a publish goes through on a signal that verified nothing.

An expired credential never had this problem — the positive `connect()` test
runs and fails. This covers the credential that stops being *present*. The
variable is opt-in and unset locally, so a laptop with two credentials keeps
working unchanged.

**Targets are throwaway.** Every `*_TEST_*` variable must point at a chat,
channel, room or number created for this and nothing else. A credential says who
you are; a target says where it is safe to write. They are separate fields in the
registry for that reason.

**Messages are marked.** Everything sent carries a run marker, so anything that
escapes into a real conversation is identifiable as test traffic at a glance.

**No retries.** `retry: 0`. A live suite that retries hides an intermittent
contract break, which is the one thing these tests exist to catch.

**One platform at a time.** `fileParallelism: false`. Parallel files race for the
same test chat and interleave their messages, and a shared rate limit turns that
into flakiness that looks like a product bug.

**Credential values are never printed.** The readiness report answers set or
not-set, never the value, and there is a test asserting it stays that way.

---

## Adding a platform

1. Create the credentials; `pnpm integration:readiness` tells you which and where.
2. Put them in `integration/.env`, and add them as repository secrets for CI.
3. Write `tests/<id>/live.test.ts`. Start from `tests/telegram/live.test.ts` —
   auth, outbound, error mapping, then inbound if the transport allows it.
4. **Run it against the real API before committing.** A live test that has never
   made a live call is a unit test with extra latency, and this repository has
   just spent a cycle removing tests that only looked like coverage.
