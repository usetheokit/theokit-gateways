# Decision ids cited in published declarations

Every `D###` that appears in a `.d.ts` this repository publishes, and whether the decision behind it
still exists here.

## Why this file exists

The docblocks cite decision ids as evidence — "per ADR D426 the mapping stays in one place". A
reader who follows one is entitled to find it. Measured on 2026-08-24: **76 distinct ids** are cited
across the eleven published declarations, and **59 of them resolve nowhere in this repository**.

They were never deleted. They were written in implementation plans under `.claude/`, which is
development tooling and is not versioned — so the decisions reached npm inside a `.d.ts` while the
documents defining them stayed on one machine. That is the shape of the defect: a citation is only
as durable as the thing it cites, and this repository was publishing citations to documents it does
not carry.

## What each status means

- **recorded** — the decision text was recovered and is named here. A reader can act on it.
- **lost** — the id is cited in a published declaration and its decision is not in this repository.
  Recorded as lost rather than deleted, because a reader who meets `D412` in a docblock is better
  served by "this decision is not recoverable" than by silence. Deleting the citations would also
  destroy the only evidence that the decisions were ever made.

A **lost** row is a debt, not a resting state. The way to clear one is to recover the decision and
promote it, or to remove the citation from the docblock that carries it.

## The ids

| id | status | decision | cited by | recovered from |
|---|---|---|---|---|
| `D101` | **lost** | — | `gateway` | — |
| `D170` | recorded | `@theokit/gateway` workspace-package separation | `gateway` | `packages/gateway/src/README.md` |
| `D171` | recorded | Each platform adapter is its own peer-dep workspace package | `gateway-discord`, `gateway-telegram` | `packages/gateway/src/README.md` |
| `D172` | recorded | `BasePlatformAdapter` abstract class | `gateway`, `gateway-whatsapp` | `packages/gateway/src/README.md` |
| `D173` | recorded | `MessageEvent` discriminated union by `platform` | `gateway` | `packages/gateway/src/README.md` |
| `D174` | recorded | `SessionRouter` composes `Agent.resume` | `gateway` | `packages/gateway/src/README.md` |
| `D175` | recorded | `DeliveryRouter` composes `Cron` | `gateway` | `packages/gateway/src/README.md` |
| `D176` | recorded | Gateway hooks are an own contract, NOT a `Plugin.kind` | `gateway` | `packages/gateway/src/README.md` |
| `D177` | recorded | Hook signature mirrors `pre_tool_call` veto pattern | `gateway` | `packages/gateway/src/README.md` |
| `D179` | **lost** | — | `gateway-discord` | — |
| `D180` | **lost** | — | `gateway-teams`, `gateway-whatsapp` | — |
| `D267` | **lost** | — | `gateway-slack` | — |
| `D268` | **lost** | — | `gateway-slack` | — |
| `D269` | **lost** | — | `gateway-slack` | — |
| `D270` | **lost** | — | `gateway-slack` | — |
| `D271` | **lost** | — | `gateway-slack` | — |
| `D272` | **lost** | — | `gateway-slack` | — |
| `D273` | **lost** | — | `gateway-slack` | — |
| `D274` | **lost** | — | `gateway`, `gateway-slack` | — |
| `D275` | **lost** | — | `gateway-matrix`, `gateway-mattermost`, `gateway-slack` | — |
| `D276` | **lost** | — | `gateway-sms` | — |
| `D277` | **lost** | — | `gateway-slack` | — |
| `D285` | **lost** | — | `gateway-slack` | — |
| `D303` | **lost** | — | `gateway-whatsapp` | — |
| `D304` | **lost** | — | `gateway-whatsapp` | — |
| `D305` | **lost** | — | `gateway-whatsapp` | — |
| `D306` | **lost** | — | `gateway-whatsapp` | — |
| `D307` | **lost** | — | `gateway-whatsapp` | — |
| `D308` | **lost** | — | `gateway` | — |
| `D309` | **lost** | — | `gateway-whatsapp` | — |
| `D310` | **lost** | — | `gateway-whatsapp` | — |
| `D312` | **lost** | — | `gateway-whatsapp` | — |
| `D314` | **lost** | — | `gateway-whatsapp` | — |
| `D315` | recorded | Read the API off the default export, not off named bindings | `gateway-teams` | plan `whatsapp-web-bridge-starts-plan` |
| `D316` | recorded | A present-but-unusable package is a distinct failure from an absent one | `gateway-teams` | plan `whatsapp-web-bridge-starts-plan` |
| `D318` | recorded | The factories take the same secondary options as the constructor | `gateway-whatsapp` | plan `whatsapp-adapter-factories-plan` |
| `D319` | recorded | Depend on a narrow socket contract we declare, not on Baileys' types | `gateway-teams`, `gateway-whatsapp` | plan `whatsapp-baileys-backend-impl-plan` |
| `D320` | recorded | Serialise sends per socket | `gateway-whatsapp` | plan `whatsapp-baileys-backend-impl-plan` |
| `D321` | recorded | A timed-out send reports unknown delivery, and is never retried | `gateway-whatsapp` | plan `whatsapp-baileys-backend-impl-plan` |
| `D322` | recorded | Connect with the hygiene settings that keep the account usable | `gateway-whatsapp` | plan `whatsapp-baileys-backend-impl-plan` |
| `D325` | **lost** | — | `gateway`, `gateway-teams` | — |
| `D326` | **lost** | — | `gateway-teams` | — |
| `D327` | **lost** | — | `gateway-email` | — |
| `D328` | **lost** | — | `gateway-email` | — |
| `D331` | **lost** | — | `gateway-email` | — |
| `D332` | **lost** | — | `gateway-email` | — |
| `D333` | **lost** | — | `gateway-email` | — |
| `D335` | **lost** | — | `gateway` | — |
| `D337` | **lost** | — | `gateway-email` | — |
| `D339` | **lost** | — | `gateway`, `gateway-email` | — |
| `D389` | **lost** | — | `gateway`, `gateway-sms` | — |
| `D391` | **lost** | — | `gateway`, `gateway-sms` | — |
| `D392` | **lost** | — | `gateway-sms` | — |
| `D393` | **lost** | — | `gateway-sms` | — |
| `D396` | **lost** | — | `gateway-sms` | — |
| `D397` | **lost** | — | `gateway`, `gateway-mattermost` | — |
| `D399` | **lost** | — | `gateway`, `gateway-mattermost` | — |
| `D400` | **lost** | — | `gateway-mattermost` | — |
| `D402` | **lost** | — | `gateway`, `gateway-mattermost` | — |
| `D403` | **lost** | — | `gateway-mattermost` | — |
| `D404` | **lost** | — | `gateway-mattermost` | — |
| `D405` | **lost** | — | `gateway`, `gateway-line` | — |
| `D407` | **lost** | — | `gateway-line` | — |
| `D408` | **lost** | — | `gateway-line` | — |
| `D409` | **lost** | — | `gateway` | — |
| `D410` | **lost** | — | `gateway`, `gateway-line` | — |
| `D411` | **lost** | — | `gateway-line` | — |
| `D412` | **lost** | — | `gateway-line` | — |
| `D413` | **lost** | — | `gateway`, `gateway-matrix` | — |
| `D414` | **lost** | — | `gateway-matrix` | — |
| `D415` | **lost** | — | `gateway-matrix` | — |
| `D416` | **lost** | — | `gateway`, `gateway-matrix` | — |
| `D419` | **lost** | — | `gateway-matrix` | — |
| `D421` | **lost** | — | `gateway`, `gateway-matrix` | — |
| `D426` | recorded | one mapping per platform, shared by the transport path and the webhook path | `gateway-sms` | plan `gateway-inbound-translation-plan` |
| `D428` | recorded | `null`, never a throw | `gateway-sms` | plan `gateway-inbound-translation-plan` |

## The gate

`pnpm quality:adr-citations` fails when a published `.d.ts` cites an id that is not a row above. A
new unresolvable citation cannot enter a published declaration without turning that gate red, which
is what stops this list from growing while nobody is looking.

Adding a row with status **lost** satisfies the gate. That is deliberate: the gate's job is to make
every citation accounted for, not to force a decision to be invented for an id whose origin is gone.
