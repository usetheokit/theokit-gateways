# The mutants that survive, and why none of them can be killed

`pnpm --filter @theokit/gateway run test:mutation` scores 95.09% over the four
source files with real branching logic. The 20 survivors are listed here with the
reason each one cannot change behaviour, so nobody re-derives it and nobody writes
a test that appears to kill one.

That distinction is the point. A surviving mutant is normally a hole in the suite.
An **equivalent** mutant is a rewrite of the code that computes the same thing, so
no test can tell the two apart, and a test that seemed to would be measuring
something else. Every entry below was checked individually; anything not on this
list is outstanding work.

## `src/text/chunk.ts` — 10, ceiling 92.6%

| Line | Mutation | Why it cannot be observed |
|---|---|---|
| 85 | `cut >= text.length` → `>` / `false` | past the end `charCodeAt` yields `NaN`, and every comparison against `NaN` is false — the early return and the fall-through agree |
| 99 | `cut > 0` → `>= 0` | at `cut === 0` the mutant keeps 0 and line 102 then returns `window`, which is what the original returns directly |
| 102 | `cut <= 0` → `<` / `false` | `cut` is `window` or a positive boundary by then, so 0 is unreachable; the check is defensive |
| 114 | `"window"` → `""` | the value is only ever compared against `"last-boundary"`, and both fail it |
| 171 | `text.length === 0` → `false` | an empty string falls to `text.length <= limit` and returns `[""]` by the other path |
| 174 | `{granularity:"grapheme"}` → `{}` | grapheme IS `Intl.Segmenter`'s default granularity |
| 184 | `buf.length > 0` → `true` / `>= 0` | the loop always appends a segment before reaching it, so `buf` is never empty there |

## `src/security/credential-patterns.ts` — 2, ceiling 98.0%

| Line | Mutation | Why it cannot be observed |
|---|---|---|
| 154 | `typeof value === "string"` → `false`; `"string"` → `""` | both send every input through `String(value)`, and `String(s)` IS `s` for a string — the ternary selects between two expressions with the same value |

## `src/runner/gateway-runner.ts` — 8, ceiling 88.2%

| Line | Mutation | Why it cannot be observed |
|---|---|---|
| 80 | `unsubs = []` seeded | `stop()` calls each entry inside `try { … } catch { /* ignore */ }`; a non-function throws and is swallowed **by design**, so shutdown survives a bad unsubscribe |
| 88 | `opts.hooks ?? []` seeded | `HookExecutor` skips any hook whose handler is `undefined`, which a non-object always is |
| 172 | `inflight.size > 0` → `true` / `>=` | entering the drain branch with an empty set still resolves immediately (`allSettled([])`) and clears its timer in `finally` |
| 188 | `timer !== undefined` → `true` | `clearTimeout(undefined)` is a no-op |
| 195 | `connected = false` → `true` | `stopped` is what refuses a restart; `connected` is not read again after `stop()` returns |
| 238 | `inflight.add(work)` removed | redundant with the add in `start()`'s `onInbound` wrapper, which puts the same dispatch in the same set |
| 259 | `activePrefix === undefined` → `false` | the loop then builds `` `${undefined}${name}` ``, which no ordinary message text equals |

Two of these are worth a second look by someone changing the code rather than the
tests, and are recorded rather than fixed here: line 88 means a **malformed hook is
silently ignored** instead of refused, which `rules/error-handling.md` § 2 would
have fail fast; line 238 is an add nothing needs.
