# Mutation testing: @theokit/gateway-teams

Run: `pnpm --filter @theokit/gateway-teams run test:mutation`

Scope, and why these files, is in `stryker.config.json`. The cross-package map is
`docs/MUTATION.md`.

## Baseline

| Date and head | Score | Mutants | Killed | Timeout | Survived | No coverage |
|---|---|---|---|---|---|---|
| 2026-10-07, `7e1c9cf` | 87.27% | 817 | 709 | 4 | 92 | 12 |
| 2026-10-08, `e7030c3` (test-quality pass) | 93.15% | 817 | 758 | 3 | 53 | 3 |
| 2026-10-09, `4db76b8` (the head the third review read, re-measured) | 93.02% | 831 | 770 | 3 | 55 | 3 |
| 2026-10-09, `4e64f4e` (verifier split into modules, review fixes) | 93.05% | 863 | 800 | 3 | 57 | 3 |
| 2026-10-09, `0ac4a8c` (tests killing the four new survivors) | 94.09% | 863 | 792 | 20 | 48 | 3 |

Read the last row with care. Stryker counts a timeout as detected, and that run timed out 20
mutants against 3 the run before, on unchanged source. Five of the new timeouts are mutants the
previous run reported as survivors and that no test can kill (`verified-claims.ts` 198, 199, 217;
`verifier-contract.ts` 83, 87, all listed below), so the extra timeouts came from load on the
machine, not from the tests. The comparable figure is the `4e64f4e` run plus the four mutants the
`0ac4a8c` tests were shown to kill: about 93.5%.

`break` stays 92: that figure less a margin of about nine mutants for timeouts. It is a ratchet:
raise it when the score rises, never lower it to make a red run green under an unchanged scope.

## The verifier's files: every survivor left, each with its reason

Anything in these files that survives and is NOT on this list is outstanding work, not an
accepted mutant. Line numbers are those of the source at `0ac4a8c`; the function is named too, so
an entry can be found after the lines move. "Unreachable" means no request can drive the code
there, and the reason names what guarantees it. A mutant listed here may show as a timeout in a
loaded run; that does not make it killed.

### `activity-verifier.ts`

| Line | Function | Mutant | Why nothing can kill it |
|---|---|---|---|
| 74 | `readBody` | `{ ok: false, reason: "malformed_body" }` -> `{}`; `"malformed_body"` -> `""`; `text === undefined` -> `false` | `readRequest` (line 152) reads only `body.ok` and refuses with its own `"malformed_body"`, and `parseActivityBody(undefined)` fails its own `JSON.parse` the same way |
| 76 | `readBody` | `{ ok: false, reason: "malformed_body" }` -> `{}`; `"malformed_body"` -> `""` | the same reason as line 74 |
| 122 | `admitToSdk` | `set === undefined` -> `false`, and the refusal text (no coverage) | unreachable: the tenant set is undefined only with no `tenantId`, and a tenant-issued token with no `tenantId` is refused `tenant_unverified` at line 118 (`checkTenant` in `verified-claims.ts`) |
| 150 | `readRequest` | `header === null` -> `false` | `readBearerToken(null)` answers `undefined`, so the second operand already refuses |
| 163, 164 | `judgeVerifiedToken` | `token === undefined` -> `false` | with no token, `claims` is undefined (163) or the first operand of 164 refuses; either sub-condition alone gives the same refusal |
| 220 | `teamsActivityVerifier` | `options.tenantId === undefined` -> `false` | builds a tenant key set no request reaches, for the reason given at 122 |

### `published-key-set.ts`

| Line | Function | Mutant | Why nothing can kill it |
|---|---|---|---|
| 71 | `keySetUnavailableMessage` | `failure === undefined` -> `false`, and `""` -> `"Stryker was here!"` (no coverage) | unreachable: `unavailable()` is answered only after a read completed, and a completed read sets either `held` or `lastFailure`; `held` defined with `lastFailure` undefined is the only case with no failure, and line 225 answers it `"unlisted"` |
| 84 | `rsaPublicKey` | `catch { return undefined; }` -> `catch {}` | an empty block returns `undefined` too |
| 225 | `keySet().lookup` | `held === undefined` -> `false` | when `held` is undefined after a completed read, `lastFailure` is defined, so the second operand already decides |

### `rs256-signature.ts`

| Line | Function | Mutant | Why nothing can kill it |
|---|---|---|---|
| 14 | `verifiesRs256` | every guard mutant (seven), and `return false` -> `return true` (no coverage) | unreachable: `verifiesRs256` runs only for a token whose header gave a `kid`, and `decodeSegment` (`verified-claims.ts` 203) answers nothing for a token without exactly three segments, so `header`, `payload` and `signature` are always strings |
| 22 | `verifiesRs256` | `catch { return false; }` -> `catch {}` | the `undefined` it returns is falsy, which `admitToSdk` (line 127) reads exactly as `false`. The `return false` itself IS killed, by replacing `crypto.verify` with one that throws: `a-signature-check-that-throws-refuses-the-token.test.ts` |

### `bounded-stream.ts`

| Line | Function | Mutant | Why nothing can kill it |
|---|---|---|---|
| 15 | `readBoundedStream` | `return ""` -> `return "Stryker was here!"` for a `null` body | both texts fail `JSON.parse`: a request body becomes `malformed_body` (a POST with no body, see `a-body-the-route-already-read-is-not-the-senders-fault.test.ts`) and a key-set body "the document is not JSON" either way |

### `sdk-validator.ts`

| Line | Function | Mutant | Why nothing can kill it |
|---|---|---|---|
| 205 | `sdkCheck` | `{ keyReadFailed: false }` -> `{}` | line 207 reads the flag as a boolean, and `undefined` is falsy |

### `verifier-contract.ts`

| Line | Mutant | Why nothing can kill it |
|---|---|---|
| 83 | `MESSAGES.validator_unavailable` -> `""` | never read: both `validator_unavailable` refusals pass their own message (`sdk-validator.ts` 186, `activity-verifier.ts` 234) |
| 87 | `MESSAGES.key_set_unavailable` -> `""` | never read: both `key_set_unavailable` refusals pass their own message (`activity-verifier.ts` 126, `sdk-validator.ts` 208) |

### `verified-claims.ts`

B-420 created this file, so its survivors are this item's.

| Line | Function | Mutant | Why nothing can kill it |
|---|---|---|---|
| 167 | `parseActivityBody` | `catch { return malformed_body }` -> `catch {}` | `value` stays `undefined`, `isPlainObject` is false, and the next line gives the same refusal |
| 198 | `readTokenAlgorithm` | `decodeSegment(rawToken, 0)?.alg` -> `.alg` | `admitToSdk` asks for the algorithm only after `readTokenKeyId` found a `kid` in the same header (`activity-verifier.ts` 115-116), so the decoded header is always an object there; nothing else calls it |
| 199 | `readTokenAlgorithm` | `typeof alg === "string"` -> `true` | a non-string `alg` returned as is still fails the `!== "RS256"` test at `activity-verifier.ts` 123 |
| 211 | `decodeSegment` | `catch { return undefined; }` -> `catch {}` | an empty block returns `undefined` too |
| 217 | `normalizeServiceUrl` | `toLowerCase()` -> `toUpperCase()` | applied to both sides of the comparison |

`error-kind.ts` has no survivor.

## Measured, not assumed

- `crypto.verify` was run against empty, 1-byte, 256-byte, 1000-byte and all-ones signatures, and
  against RSA moduli of 2 to 64 bytes built from a JWK. It returned `false` every time and never
  threw, which is why the `rs256-signature.ts` line-22 test replaces it rather than feeding it a
  bad input.
- A 204 from the key endpoint reaches the verifier with `response.body === null` (Node 22 fetch),
  which is the only way a key-set read reaches `bounded-stream.ts` line 15; a POST with no body is
  the request-side way.
- A body cut part-way fails `reader.read()` with a `TypeError` whose cause is
  `SocketError UND_ERR_SOCKET`, which `requestFailure` reports as `the request failed (...)`.
- The four survivors the `0ac4a8c` tests kill (`verified-claims.ts` 81 and 90 twice,
  `published-key-set.ts` 219) were each applied by hand and failed the new cases.

## Out of this pass

`errors.ts`, `normalize.ts` and `split.ts` predate the inbound verifier (they are on
`origin/develop` before B-420) and carry 23 survivors that are not judged here.
