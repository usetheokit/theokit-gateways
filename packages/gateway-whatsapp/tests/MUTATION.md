# Mutation testing — @theokit/gateway-whatsapp

Run: `pnpm --filter @theokit/gateway-whatsapp run test:mutation`

Deliberately outside `test`, so `pnpm -r run test` never pays for it. Scope, and why these five
files and not the others, is in `stryker.config.json`.

## Baseline

| Date | Score | Killed | Survived |
|---|---|---|---|
| 2026-08-30 (first ever) | 73.96% | 125 | 44 |
| 2026-08-30 (after this pass) | 95.86% | 162 | 7 |
| 2026-10-06 (`inbound-rules.ts` and `signature.ts` in scope) | 96.90% | 281 | 9 |
| 2026-10-09 (foreign phone number id redacted in `inbound-rules.ts`) | 97.00% | 291 | 9 |

`break` is set to the measured figure with headroom for two mutants (one mutant is ~0.59% of 169).
It is a ratchet: raise it when the score rises, never lower it to make a red run green.

Before this run **no adapter package in this repository had ever been measured** — only
`packages/gateway`. The 44 survivors were not a surprise so much as an absence: nothing had asked.

## The 9 survivors, each with its reason

Anything NOT on this list is outstanding work, not an accepted mutant.

### `allowlist.ts` — 5, all EQUIVALENT

Proven equivalent by running every variant against the address shapes WhatsApp emits
(`@s.whatsapp.net`, `@g.us`, `@lid`, `@c.us`, with and without a `:device` suffix), the shapes a
human types into an env var, and the hostile ones (`""`, `"@"`, `"abc"`). Zero of eleven inputs
differ, so no test can kill one — and a test that appeared to would be measuring something else.

| Line | Mutant | Why nothing can kill it |
|---|---|---|
| 36 | device-strip replacement `""` → `"Stryker was here!"` | the final `.replace(/\D/g, "")` erases any inserted letters, so the output is identical |
| 37 | `/@.*$/` → `/@.*/` | without the `m` flag and without `g`, the two match the same span |
| 37 | domain-strip replacement `""` → `"Stryker was here!"` | same digit-strip as line 36 |
| 49 | `raw ?? ""` → `raw ?? "Stryker was here!"` | the fallback normalises to `""` and is dropped by the `length > 0` filter, so the set is empty either way |
| 72 | `if (allowed.size === 0) return false;` → `if (false)` | the guard is redundant for BEHAVIOUR: an empty `Set` answers `false` to every `has()` below it. It stays because it states the fail-closed decision at the point the decision is made, which the docblock above it argues for at length. Documenting an invariant is a legitimate reason for a line no test can kill |

The sixth survivor here was **not** equivalent and is now dead: `/@.*$/` → `/@.$/` leaks digits
from a domain into the phone number. Unreachable for WhatsApp's own domains, which are all
letters — reachable through allowlist entries, which an operator types by hand.

### `split.ts` — 2, EQUIVALENT under this configuration

| Line | Mutant | Why nothing can kill it |
|---|---|---|
| 24 | `stripLeading: /^\s+/` → `/\s+/` | |
| 24 | `stripLeading: /^\s+/` → `/^\s/` | |

Measured, not assumed: `chunkText` applies `stripLeading` to the REMAINDER after a cut, and it
consumes the boundary character as it cuts — so the remainder never begins with whitespace. Four
constructed cases (space boundary, multi-space boundary, newline-then-space, hard cut landing in a
run of spaces) produce byte-identical output for all three regexes.

**`stripLeading` is therefore inert in this package's configuration.** Removing it is a behaviour
change nobody has asked for and it is left alone; what is recorded here is that it does nothing, so
the next reader does not spend an afternoon writing a test that cannot exist.

### `errors.ts` — 0

100%.

### `inbound-rules.ts`: in the configured scope since 2026-10-06

`src/inbound-rules.ts` holds the sender allowlist, the group rule and the conversion that used to be
private methods of `adapter.ts`, which is why no run had measured them. B-421 first measured it with
`pnpm exec stryker run --mutate src/inbound-rules.ts`; the review's fix pass then added it to
`mutate`, so `break` guards it. The whole configured scope measured 95.38% (238 mutants) on
2026-10-06, before the "refusal line redacted" row below: the three survivors on `redactedSender`'s "no number"
branch were then killed by a test for a sender with no digit.

| Date | Score | Killed | Survived |
|---|---|---|---|
| 2026-10-06 (first) | 83.33% | 55 | 11 |
| 2026-10-06 (after four boundary tests) | 93.94% | 62 | 4 |
| 2026-10-06 (after removing the dead filter) | 98.33% | 59 | 1 |
| 2026-10-06 (refusal line redacted, in `mutate`) | 94.2% | 65 | 3 + 1 no coverage |
| 2026-10-09 (foreign phone number id redacted and its report set bounded) | 98.97% | 96 | 1 |

Seven survivors were real gaps: a bot number at the very start or end of a group message, a
one-digit run, and the exact "dropping every group message" line. Three sat on
`.filter((d) => d.length > 0)` after `.map(digitsOnly)`: every `PHONE_RUN` match starts and ends
with a digit, so no run normalizes to `""` and the filter could never drop anything. It was removed
rather than documented, because unlike `stripLeading` above it was a guard against a value the
regex cannot produce.

| Line | Mutant | Why nothing can kill it |
|---|---|---|
| `phoneRuns` | `s.match(PHONE_RUN) ?? []` becomes `?? ["Stryker was here"]` | EQUIVALENT. The fallback only applies when the text has no digit; the string normalizes to `""`, and `"".includes(botPhoneId)` is false for every non-empty id, the only kind the group rule reaches. The message is dropped either way |

### `backend/cloud/signature.ts`: in the configured scope since 2026-10-06

`verifyWebhookSignature` decides whether a POST is Meta's, and since B-421 it refuses an empty or
whitespace-only app secret. It lived in `webhook.ts` beside the envelope normalizers, and putting
that whole file in scope measured 45 survivors in the normalizers (86.58%) without isolating the
refusal; the function moved to `signature.ts` so this scope measures the signature check alone.
The normalizers stay unmeasured, which is outstanding work and not an accepted gap.

In the first run (the function still inside `webhook.ts`) the empty-secret refusal and the length
guard had no survivor, and ten mutants of the function survived, handled this way:

- Two on the `sha256=` prefix check and two on the hex check were real gaps: no test sent the right
  digest under another prefix, or the right digest followed by non-hex characters (which
  `Buffer.from(hex, "hex")` silently drops). Both now have a test.
- Five sat on a line that converted a string body to a UTF-8 Buffer before hashing. `hmac.update`
  already reads a string as UTF-8, so the line was removed rather than documented.
- One is equivalent, and is the only survivor of the 34 mutants `signature.ts` now has:

| Line | Mutant | Why nothing can kill it |
|---|---|---|
| hex check | `/^[0-9a-f]+$/i` becomes `/[0-9a-f]+$/i` | EQUIVALENT. Without `^`, only a header whose hex part starts with a non-hex character passes the check differently, and `Buffer.from(hex, "hex")` stops at the first non-hex character, so that header decodes to an empty buffer and fails the length guard either way |

The foreign phone number id check (`isForAnotherNumber`, in `inbound-rules.ts`) left no survivor,
and still left none on 2026-10-09 after it began naming the id by its last four digits.
