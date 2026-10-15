# ADR-0007: Suite-economy caps wait for a consolidation item

- Status: Accepted
- Date: 2026-10-12
- Deciders: Paulo (project owner), for sprint S-001
- Evidence: the `loop-test-audit` reports of `gateway-teams-inbound-verifier` (at fc1552c) and
  `gateway-whatsapp-deliverable-event` (at a145874), under `.squad/records/audits/`

## Context and Problem Statement

`loop-test-audit` measures each test against the mutants it kills. It caps the verdict INVALID
when tests kill no mutant the rest of the suite misses (`suite_bloat_redundant`), and when that
share passes 20% (`suite_bloat_ceiling`). On the two gateway items of S-001 both caps fired:
266 of 309 tests in one run, 137 of 196 in another. The same audits measured the suites as
strong detectors: 94.5% of mutants killed on the Teams verifier.

The caps say the suites hold more tests than they need. They do not say behaviour is untested.
Consolidating them is real work, and each fix round of these items reruns the test audit for two
to three hours.

## Decision

Both items ship with these two caps dismissed. Every other finding of the test audit still blocks:
on the WhatsApp item that includes `fake_test_gaming` and `secret_exposed`, which are being fixed.

Consolidating the redundant tests of `packages/gateway-teams` and `packages/gateway-whatsapp` is a
followup, registered in each item's plan under `## Followups`. When that work lands, this record
is superseded and the caps block again.

<!-- AUDIT-CAP-DISMISSED: loop-test-audit: suite_bloat_redundant: the suites hold redundant tests and still kill 94.5% of mutants; consolidating them is a registered followup of S-001 -->
<!-- AUDIT-CAP-DISMISSED: loop-test-audit: suite_bloat_ceiling: the same measurement as suite_bloat_redundant, read as a share of the suite; same followup -->

## Consequences

- The dismissal is read by the coverage gate for every item of this repository, not only these
  two, until this record is superseded. A later item whose tests are redundant will pass these two
  caps as well, which is why the record names the work that ends it.
- The caps stay in each audit report; nothing about the measurement changes.
