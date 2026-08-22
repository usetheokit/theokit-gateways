---
"@theokit/gateway": patch
---

**The tools suite no longer fails when the whole monorepo runs at once.** Several of its tests drive the TypeScript compiler in-process, which pays a one-time lib-loading cost. Alone that fits inside vitest's 5s default; under `pnpm -r test`, with twelve package suites competing for the same cores, it did not — so the gate reported a failure that was about machine load, not about the code under test. The timeout now states what the work costs.
