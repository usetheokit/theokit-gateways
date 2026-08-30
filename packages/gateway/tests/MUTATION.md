# The mutants that survive, and why none of them can be killed

`pnpm --filter @theokit/gateway run test:mutation` scores 95.6% over the four
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

## `src/hooks/executor.ts` — 1, ceiling 98.9%

| Line | Mutation | Why it cannot be observed |
|---|---|---|
| 32 | `"gateway"` → `""` | the package prefix reaches `GatewayConfigurationError`, which only uses it to BUILD a default message (`` `${prefix}: ${code}` ``); every refusal here passes an explicit `message`, so the prefix is never read |

## `src/runner/gateway-runner.ts` — 7, ceiling 94.5%

| Line | Mutation | Why it cannot be observed |
|---|---|---|
| 80 | `unsubs = []` seeded | `stop()` calls each entry inside `try { … } catch { /* ignore */ }`; a non-function throws and is swallowed **by design**, so shutdown survives a bad unsubscribe |
| 172 | `inflight.size > 0` → `true` / `>=` | entering the drain branch with an empty set still resolves immediately (`allSettled([])`) and clears its timer in `finally` |
| 188 | `timer !== undefined` → `true` | `clearTimeout(undefined)` is a no-op |
| 195 | `connected = false` → `true` | `stopped` is what refuses a restart; `connected` is not read again after `stop()` returns |
| 238 | `inflight.add(work)` removed | redundant with the add in `start()`'s `onInbound` wrapper, which puts the same dispatch in the same set |
| 259 | `activePrefix === undefined` → `false` | the loop then builds `` `${undefined}${name}` ``, which no ordinary message text equals |

One entry left this list by being fixed rather than explained. `gateway-runner.ts:88`
— seeding the default hook array with a non-hook — used to survive because
`HookExecutor` skipped anything whose handler was `undefined`, which is what a
malformed entry always looks like. That was issue #80: a **malformed hook silently
ignored** where `rules/error-handling.md` § 2 asks for fail-fast. The executor now
refuses it at construction, so the mutant is detectable and dies. A survivor that
disappears because the code got better is the outcome this file exists to make
possible — reading the list is how you tell those apart from the ones that cannot
move.

Still recorded rather than fixed: `gateway-runner.ts:238` is an `inflight.add`
nothing needs, redundant with the one in `start()`'s `onInbound` wrapper.
