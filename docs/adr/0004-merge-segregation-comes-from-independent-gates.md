# ADR-0004: Segregation of duties on `main` comes from independent gates, not a human approver

- Status: Accepted
- Date: 2026-10-06
- Deciders: Paulo (project owner), in the S-001 session
- Context source: the `loop-delivery-audit` reports for B-420 and B-421

## Context and Problem Statement

Every review of a change in this repository runs `loop-delivery-audit`, and every run returns
`INVALID` with two hard caps that no change in this repository can clear:

- `soc2_control_bypassed`: a SOC 2 control (CC8.1, change approval) was bypassed in the evidence
  window, because `main` has no required human reviewer;
- `no_segregation_of_duties`: one identity authored, approved and deployed a production change
  (CC6.3).

Both caps describe how `main` is governed, not the code under review. The B-421 review on
2026-10-06 carried them as BLOCKERs although its range touched no workflow and no release file.

The development process this repository runs under decides the opposite on purpose. Its autonomy
envelope (floor 2) lets the system merge a pull request into `main` once its whole chain passed, and
treats a remote that requires a human reviewer as a violated premise rather than a supported
configuration, because a pause addressed to a person who is not coming is a stopped release.

## Decision

Segregation of duties for a change reaching `main` is provided by gates that are independent of the
author, not by a second human:

- every change passes a review by reviewers that are not its author, plus the required independent
  `loop-*` audits for its domains;
- every plan is approved by a review panel of three seats spanning two model families, with the
  author excluded;
- the merge happens only when every gate passed, and moving a threshold to pass one is forbidden.

The two caps above are therefore dismissed for this repository. Their findings stay in each report
and are read as this recorded decision, not as a defect of the change under review.

## Considered Options

1. **Dismiss the two caps by this ADR** (chosen). Keeps the autonomous merge the process depends on
   and states where segregation comes from instead.
2. **Require a human approver on `main`** (branch protection plus a `release` environment with
   required reviewers who are not the deployer). Rejected: it satisfies the audit, but every release
   then stops at an open pull request waiting for a person, which is the failure the autonomy
   envelope exists to prevent.
3. **Drop `loop-delivery-audit` from the infrastructure review.** Rejected: it would also stop
   auditing the CI and release pipeline on every infrastructure change, which the other findings of
   that audit still earn.

## Consequences

- A SOC 2 assessment of this repository would read CC6.3 and CC8.1 as met by automated independent
  review, not by human approval. Whoever needs a SOC 2 opinion must accept that model or reopen this
  ADR.
- Nothing reads this ADR mechanically yet: the review's coverage gate turns any computed blocking
  audit verdict into a BLOCKER. Until the gate honours a recorded dismissal, the review of a change
  here still shows these caps, and the reviewer cites this ADR when adjudicating them.
- Revisit when a human approver joins the project, or when a customer or certification requires
  human change approval.
