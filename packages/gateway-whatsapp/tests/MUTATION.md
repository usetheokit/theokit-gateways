# Mutation testing — @theokit/gateway-whatsapp

Run: `pnpm --filter @theokit/gateway-whatsapp run test:mutation`

Deliberately outside `test`, so `pnpm -r run test` never pays for it. Scope, and why these three
files and not the others, is in `stryker.config.json`.

## Baseline

| Date | Score | Killed | Survived |
|---|---|---|---|
| 2026-08-30 (first ever) | 73.96% | 125 | 44 |
| 2026-08-30 (after this pass) | 95.86% | 162 | 7 |

`break` is set to the measured figure with headroom for two mutants (one mutant is ~0.59% of 169).
It is a ratchet: raise it when the score rises, never lower it to make a red run green.

Before this run **no adapter package in this repository had ever been measured** — only
`packages/gateway`. The 44 survivors were not a surprise so much as an absence: nothing had asked.

## The 7 survivors, each with its reason

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
