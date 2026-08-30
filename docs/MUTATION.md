# Mutation testing across the gateways

Run one package: `pnpm --filter @theokit/gateway-<name> run test:mutation`

Deliberately outside `test`, so `pnpm -r run test` in CI never pays for it. Each package's
`stryker.config.json` states its own scope and threshold; this file is the map.

## Why it exists

Every gate in this repository grades the code against artefacts the repository itself produces:
tests pass, types check, the linter is quiet. None of them answers the question mutation testing
answers — **can these tests detect a defect at all?** A suite can be green, fast, and comprehensive
in line count while asserting nothing that a broken implementation would violate.

Until 2026-08-30 only `packages/gateway` had ever been measured. The ten adapters had not.

## Baseline

| package | first measurement | after | survivors | `break` |
|---|---|---|---|---|
| gateway (core) | — (measured for months) | 95.63% | 20 | 95 |
| gateway-whatsapp | 73.96% | 95.86% | 7 | 95 |
| gateway-matrix | 91.53% | **100.00%** | 0 | 98 |
| gateway-sms | 83.72% | 93.02% | 2 | 90 |
| gateway-mattermost | 85.42% | 90.63% | 8 | 89 |
| gateway-telegram | 81.75% | 90.08% | 23 | 89 |
| gateway-line | 81.13% | 89.62% | 10 | 88 |
| gateway-discord | 62.50% | 87.50% | 1 | 75 |
| gateway-slack | 76.40% | 87.28% | 20 | 86 |
| gateway-email | 62.42% | 86.71% | 39 | 86 |
| gateway-teams | 70.43% | 86.56% | 27 | 84 |

`break` is each package's measured figure with one mutant of headroom. It is a **ratchet**: raise it
when the score rises, never lower it to make a red run green under an unchanged scope. Where the
mutant set is small the threshold is necessarily coarse — discord has eight mutants, so one is 12.5
points, and its `break` is well under its score for that reason alone.

## What is measured, and what is not

Scope is the same everywhere: **normalisation, filtering, splitting, error mapping, parsing** — the
files that decide something. `adapter.ts` is excluded in every package, because it is I/O
orchestration whose tests drive fakes, and mutating it measures the fakes rather than the adapter.
The WhatsApp bridge is a `.mjs` child process Stryker cannot instrument.

That exclusion is a real limit, stated rather than hidden: a defect in an adapter's connect/send
plumbing is not covered by these numbers.

## What the first measurement found

Not thin coverage — **tests that could not fail**. The ones worth remembering:

- A test asserting the remedy in an error message checked words **Meta's own message already
  contained**, and the fallthrough returns that message verbatim. It passed whether or not the
  branch it was named for ran.
- Slack's bot loop guard was **subsumed by the line after it**, so every mutant of it survived —
  and the one case it never reached was another bot's `thread_broadcast`, which reached the agent.
  Two agents in a channel would answer each other indefinitely. Fixed.
- Telegram's markdown-pair balancing, the whole EC-J feature, was undetectable: both its tests
  built input that was balanced everywhere, so `count % 2 === 0` held whether or not the balancer
  ran.
- Teams stamped every event with the time it was **processed** rather than the time it was sent.
  Invisible, because only the invalid-timestamp case had a test and it asserts `>= before`, which
  `Date.now()` satisfies whatever the input was. The same defect was in LINE.
- Matrix registered its timeline listener under an event name the mock **discarded** (`_evt`), so
  the name could have been the empty string. An adapter subscribed to the wrong event receives
  nothing and looks perfectly wired.
- Email's SMTP ladder took one representative per branch and never read a `message`, leaving every
  untaken alternative free and the entire diagnostic text unpinned.

## The remaining survivors

Each package's surviving mutants are analysed rather than accepted. Two shapes recur:

**Redundant defence.** Two independent guards enforce one property, so removing either alone
changes nothing. Matrix's `disconnect()` has both a `connected` check and a `client = undefined`;
LINE's `normalizeRefs` filters empties twice, once before and once after `stripBraces`. These are
unkillable by construction, and that is a property of the code rather than a gap in the tests.

**Inert configuration.** `stripLeading` in the thin split wrappers does nothing: `chunkText`
consumes the boundary as it cuts, so the remainder never begins with whitespace. Four constructed
cases produce byte-identical output for every variant of the regex.

Both are recorded where they were found — `packages/gateway/tests/MUTATION.md` and
`packages/gateway-whatsapp/tests/MUTATION.md` hold the per-mutant tables for the two packages where
the analysis is exhaustive. Anything not written up is outstanding work, not an accepted mutant.
