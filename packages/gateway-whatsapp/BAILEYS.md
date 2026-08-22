# The Baileys backend — what it is, and how to check it actually works

`WhatsAppBaileysBackend` speaks the WhatsApp Web multi-device protocol over a WebSocket.
The `web` backend does the same job by driving a headless Chromium through
`whatsapp-web.js`; this one holds a socket. That is the whole difference in kind.

## Read this before using it

**It is unofficial, and no amount of code changes that.** It automates a WhatsApp Web
session, which Meta's terms do not sanction and which can get a number banned. Use a number
created for this and nothing else — a separate phone or an eSIM. Never a personal number,
and never a number a business depends on.

If the number has Cloud API access, use `WhatsAppAdapter.fromCloud`. The official path has
no ban concept, and everything below stops being your problem.

## What the test suite proves, and what it does not

27 tests drive an injected fake socket, and they pass with `baileys` **not installed** —
deliberately, because it is an optional peer dependency and CI does not install it.

They prove our logic: that a group message resolves its sender from `participant` rather
than from the group, that sends do not interleave, that a timeout reports undetermined
delivery instead of failure, that a handler which throws is contained.

**They prove nothing about WhatsApp.** Pairing needs a QR scan by a human and there is no
WhatsApp in Docker, so protocol conformance, delivery, receipts and ban behaviour are
untested here and by every gate in this repository. A green suite means our logic does what
we think, not that WhatsApp agrees.

Closing that gap is the manual procedure below. Its result is a note in a pull request, not
a green check — there is no honest way to make it one.

## Manual validation

Once, on a throwaway number.

```bash
pnpm add baileys                      # optional peer, >=7.0.0-rc14
mkdir -p /tmp/wa-session
```

```ts
import { WhatsAppAdapter } from "@theokit/gateway-whatsapp";
import { GatewayRunner } from "@theokit/gateway";

const adapter = WhatsAppAdapter.fromBaileys(
  { sessionDir: "/tmp/wa-session" },
  {
    // Fail-closed by choice: name the number you will test from. Leaving this unset admits
    // nobody, which is the safe default and not what you want for a manual check.
    allowedSenders: "5511999999999",
    // The web-style backends have no phone id to default from, so an unset one drops every
    // group message. Set it or turn the mention requirement off.
    requireMention: false,
  },
);

const runner = new GatewayRunner({
  adapters: [adapter],
  handler: async (event, ctx) => {
    console.log("inbound:", event.text, "from", event.sender.id);
    await ctx.reply(`echo: ${event.text}`);
  },
});

await runner.start();
```

The first run prints a QR code to pair. Scan it from the throwaway number's WhatsApp:
**Settings → Linked devices → Link a device**. The pairing lands in `sessionDir` and
survives a restart, so this is a one-time cost.

### What to check, and what each answer means

| # | Step | What a pass tells you |
|---|---|---|
| 1 | Pair, restart the process | The multi-file auth state persists. `creds.update` is being saved |
| 2 | Send a DM to the number from another phone | Inbound arrives, `fromPhone` is the sender's digits with no device suffix |
| 3 | The echo comes back | Outbound reaches the socket and WhatsApp accepts the payload shape |
| 4 | Send from a number NOT in `allowedSenders` | Nothing is answered, and stderr names the refused sender |
| 5 | Add the bot to a group, send with `requireMention: false` | `conversationType` is `group`, `channelId` is the group, `fromPhone` is the participant — **not** the group |
| 6 | Kill the phone's network for a minute, restore it | The socket recovers, or it does not and you have learned the reconnect story this backend does not yet have |

Step 5 is the one worth being careful about. It is the difference between a per-sender
session key that works and one that files every group member under the group.

Step 6 is deliberately open. This backend does **not** reconnect on its own: a
`connection.update` carrying `close` sets `connected` to false and stops sends, and nothing
dials again. That is a gap, stated rather than discovered later.

### Do not

- Do not run this against a number that matters.
- Do not commit `sessionDir`. It **is** the session — anyone holding it is the account.
- Do not read a passing manual run as permission to skip it next time. The protocol changes
  under us; that is what the whole live-test package in this repository exists to notice.

## Known gaps

| Gap | Why it is a gap and not a bug |
|---|---|
| No automatic reconnect | v1 reports a closed socket and stops. Reconnect needs a backoff policy and a decision about how long to keep trying, and neither has been asked for |
| `onStatusReceipt` never fires | Declared for the interface. Baileys reports receipts on `messages.update`, which v1 does not consume. Registering a handler is accepted and it is never called — said here rather than left to be discovered from silence |
| Text only | Like both sibling backends in v1. Media, reactions and polls are not handled |
| No comparison against the `web` backend | The reason this was added rather than substituted was that the comparison becomes measurable. It has not been measured yet, and claiming a winner now would be the assertion the whole cycle refused |
