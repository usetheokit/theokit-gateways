---
"@theokit/gateway-matrix": minor
"@theokit/gateway-line": minor
---

Widen the platform SDK peer ranges, each major verified against the real platform.

`gateway-matrix` accepts `matrix-js-sdk ^32.0.0 || ^42.0.0`, and `gateway-line` accepts
`@line/bot-sdk ^9.0.0 || ^11.0.0`.

For Matrix this is a security fix for consumers rather than a convenience. The old `^32.0.0`
floor could not reach any version carrying the five advisories' fixes — including a HIGH, where
key history sharing could share keys to malicious devices, fixed in `>=34.8.0`. A consumer could
not patch it alone: raising their own dependency put them outside the range this package
declared.

Both majors of both ranges were exercised against the real platform, not only typechecked. The
Matrix live contracts pass 7/7 against a Synapse homeserver at 32.4.0 and at 42.2.0, with
per-test timings within 5ms of each other; the LINE live contracts pass 6/6 against the real
LINE API at 9.9.0 and at 11.2.0.

Each package now declares the SDK as an explicit devDependency. Until now neither did, so what
their suite ran against was whatever pnpm's peer auto-install happened to pick — the test target
was an accident rather than a decision.
