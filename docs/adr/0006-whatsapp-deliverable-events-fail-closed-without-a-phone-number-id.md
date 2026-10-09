# ADR-0006: WhatsApp `toDeliverableEvents` fails closed without a phone number id

- Status: Accepted
- Date: 2026-10-09
- Deciders: gateway cluster maintainers, on the coordinator's decision for B-421
- Evidence: the `gateway-whatsapp-deliverable-event` plan and its loop-code-review report at
  003dc44 (findings #14, #29 and #32)

## Context and Problem Statement

B-421 adds `WhatsAppAdapter.toDeliverableEvents(envelope)`, so an application that hosts its own
Meta Cloud webhook route can turn an envelope into the events `deliver()` accepts. One Meta app
signs the webhooks of every phone number it serves with one secret, so a valid signature does not
say which number a message was for. The adapter drops a message addressed to another
`phone_number_id` by comparing it with the `phoneNumberId` its backend declares.

`WhatsAppBackend.phoneNumberId` is optional, because the web and Baileys backends have no such id.
When the field is absent the comparison was skipped and every message was delivered. The review
(finding #29) showed what that means in practice: an adapter over a backend that wraps
`WhatsAppCloudBackend({ phoneNumberId: 'PNID' })` by delegation, for logging, metrics or retries,
returned one event for an envelope addressed to `OTHER` and one for an envelope with no metadata,
with nothing written to stderr. In a multi-number deployment every number's customer messages
reach every number's agent, and signature verification cannot catch it.

The fail-open was documented and deliberate, so changing it is a decision, not a bug fix.

## Decision

**`toDeliverableEvents` throws `ConfigurationError` with code `missing_phone_number_id` when the
adapter's backend declares no `phoneNumberId`.**

- `fromCloud`, `new WhatsAppAdapter(new WhatsAppCloudBackend(...))` and any backend that declares
  the field behave as before: own-number messages are delivered, foreign ones dropped and named
  once on stderr by their last four digits.
- A backend that wraps `WhatsAppCloudBackend` must expose `phoneNumberId`. The error message says
  so.
- `toDeliverableEvent(inbound)` and the `onInbound` path are unchanged. Neither takes a Cloud
  envelope from an application route, and `isForAnotherNumber` keeps its contract that `undefined`
  means "no number to compare".

`toDeliverableEvents` is new in this unreleased minor version of `@theokit/gateway-whatsapp`, so
tightening it breaks no published consumer.

## Considered Options

1. **Fail closed (chosen).** The method whose only input is a Cloud envelope refuses to run
   without the one fact that makes a Cloud envelope safe to deliver. The error arrives at the
   first webhook, at the line that caused it, and names the fix.
2. **Keep fail-open and warn on stderr.** Rejected: the route still delivers every number's
   messages; the warning only records that it happened. A warning written once is also easy to
   miss in a busy log, and the review's probe shows the wrapped case is the one most likely to go
   unnoticed.
3. **Make `phoneNumberId` required on `cloud`-kind backends through a discriminated type.**
   Rejected for now: it changes the exported `WhatsAppBackend` type, which is published, and a
   type cannot stop a JavaScript caller or a cast. It may still be worth doing on the next major;
   the runtime check would stay either way.

## Consequences

- A route built on an adapter whose backend declares no number now fails on its first webhook
  instead of delivering everything. That is the intended outcome; the fix is one field.
- An adapter over the web or Baileys backend cannot use `toDeliverableEvents`. Those backends do
  not receive Meta Cloud envelopes, so no working route loses anything.
- Two tests changed with the contract: `deliverable-event.test.ts` no longer asserts that a
  foreign message is delivered by an adapter with no number (it now asserts the throw), and its
  `ThrowingBackend` declares `PNID`. A delegating-wrapper test pins both halves: undeclared
  throws, declared filters. `inbound-rules.test.ts`, which pins `isForAnotherNumber` with
  `undefined`, is unchanged, because that function's contract did not change. This closes review
  finding #32.

## The webhook signature module belongs to B-421

Review finding #14 (LCR0202 at `packages/gateway-whatsapp/src/backend/cloud/webhook.ts:42`)
reported that the reviewed tree did not compile: `webhook.ts` re-exports `verifyWebhookSignature`
from `./signature.js`, and that module was absent from the audit's scope.

The audit scoped the item by the `Plan: gateway-whatsapp-deliverable-event` line in commit
bodies. Four commits that are B-421 review fixes do not carry that line:

| Commit | Subject | Names |
|---|---|---|
| d55423b | move the webhook signature check into its own module | F-tests-9 |
| 5ffe24c | hand the raw body straight to the HMAC | F-tests-9 |
| 94e500a | put the webhook signature check under Stryker | F-tests-9 |
| 3a249c3 | refuse to verify a webhook with an empty app secret | finding #61 (B-421) |

Each one's body names a B-421 review finding, and `.changeset/whatsapp-empty-app-secret.md` came
with them. **This ADR declares those four commits, and that changeset, part of B-421.** At
`workspace` HEAD `signature.ts` exists, and the package builds, typechecks and passes its tests.
The signature module itself was not reviewed by that audit and still needs a review that covers
it.

<!-- AUDIT-CAP-DISMISSED: loop-code-review: LCR0202@packages/gateway-whatsapp/src/backend/cloud/webhook.ts#L42: the four signature-module commits are B-421 work without a Plan line; this ADR declares them part of the item and the module compiles at HEAD -->
