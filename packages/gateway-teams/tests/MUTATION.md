# Mutation testing: @theokit/gateway-teams

Run: `pnpm --filter @theokit/gateway-teams run test:mutation`

Scope, and why these five files, is in `stryker.config.json`. The cross-package map is
`docs/MUTATION.md`.

## Baseline

817 mutants in every row.

| Date | Score | Killed | Timeout | Survived | No coverage |
|---|---|---|---|---|---|
| 2026-10-07 (HEAD `7e1c9cf`, before this pass) | 87.27% | 709 | 4 | 92 | 12 |
| 2026-10-08 (after this pass) | 93.15% | 758 | 3 | 53 | 3 |

The score was 89.42% on 2026-10-06 and fell under `break` while B-420 grew the verifier. `break` is
92 since this pass (the measured 93.15% less a margin for timeouts) and is a ratchet: raise it when the score rises, never lower it to make a red run
green under an unchanged scope.

## `activity-verifier.ts`: the survivors left, each with its reason

Anything in this file that survives and is NOT on this list is outstanding work, not an accepted
mutant. Every entry was checked against the source at `7e1c9cf`; "unreachable" means no request
can drive the code there, and the reason names the line that guarantees it.

| Line | Mutant | Why nothing can kill it |
|---|---|---|
| 119 | `MESSAGES.validator_unavailable` → `""` | never read: every `validator_unavailable` refusal passes its own message (lines 355 and 745), so the default is dead text |
| 123 | `MESSAGES.key_set_unavailable` → `""` | never read: both `key_set_unavailable` refusals pass their own message (lines 376 and 643) |
| 300 | `return ""` → `return "Stryker was here!"` for a `null` body | both texts fail `JSON.parse`: a request body becomes `malformed_body` and a key-set body "the document is not JSON" either way |
| 320, 322 | `{ ok: false, reason: "malformed_body" }` → `{}`; `"malformed_body"` → `""`; `text === undefined` → `false` | `readRequest` reads only `body.ok` and refuses with its own `"malformed_body"` (line 669), and `parseActivityBody(undefined)` fails its own `JSON.parse` the same way. The audit reached the same conclusion (oracle#42) |
| 373 | `{ keyReadFailed: false }` → `{}` | line 375 reads the flag as a boolean, and `undefined` is falsy |
| 440 | `failure === undefined` → `false`, and `""` → `"Stryker was here!"` (no coverage) | unreachable: `unavailable()` is answered only after a read completed (line 585), and a completed read sets either `held` or `lastFailure`, so `held` defined with `lastFailure` undefined is the only case with no failure, and line 588 answers that one `"unlisted"` |
| 453 | `catch { return undefined; }` → `catch {}` | an empty block returns `undefined` too |
| 588 | `held === undefined` → `false` | when `held` is undefined after a completed read, `lastFailure` is defined, so the second operand already decides |
| 596 | every guard mutant, and `return false` → `return true` (no coverage) | unreachable: `verifiesRs256` runs only for a token whose header gave a `kid`, and `decodeSegment` (`verified-claims.ts:173`) answers nothing for a token without exactly three segments, so `header`, `payload` and `signature` are always strings |
| 604 | `catch { return false; }` → `catch {}` | the `undefined` it returns is falsy, which line 644 reads exactly as `false`. The `return false` itself (605) IS killed, by replacing `crypto.verify` with one that throws: see `a-signature-check-that-throws-refuses-the-token.test.ts` |
| 639 | `set === undefined` → `false`, and the refusal message (no coverage) | unreachable: the tenant set is undefined only with no `tenantId`, and a tenant-issued token with no `tenantId` is refused `tenant_unverified` two lines earlier (line 635, `checkTenant` at `verified-claims.ts:208`) |
| 667 | `header === null` → `false` | `readBearerToken(null)` answers `undefined`, so the second operand already refuses |
| 679, 680 | `token === undefined` → `false` | with no token, `claims` is undefined (line 679) or the first operand of 680 refuses; either sub-condition alone gives the same refusal. The audit's oracle#44 |
| 731 | `options.tenantId === undefined` → `false` | builds a tenant key set that line 635 never lets a request reach, for the reason given at 639 |

## Measured, not assumed

- `crypto.verify` was run against empty, 1-byte, 256-byte, 1000-byte and all-ones signatures, and
  against RSA moduli of 2 to 64 bytes built from a JWK. It returned `false` every time and never
  threw, which is why the line-605 test replaces it rather than feeding it a bad input.
- A 204 from the key endpoint reaches the verifier with `response.body === null` (Node 22 fetch),
  which is the only way line 300 runs; a 304 is the null-body non-OK answer that line 518 handles.
- A body cut part-way fails `reader.read()` with a `TypeError` whose cause is
  `SocketError UND_ERR_SOCKET`, which line 503 reports as `the request failed (...)`.

## Out of this pass

`errors.ts`, `normalize.ts`, `split.ts` and `verified-claims.ts` carry survivors that predate the
inbound verifier (B-420). They are not judged here; the audit filed the five `verified-claims.ts`
ones as suspected equivalent (oracle#45).
