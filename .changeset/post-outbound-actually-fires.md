---
"@theokit/gateway": patch
---

**The `post_outbound` hook now fires.** It is one of the three fire points `GatewayHook` documents and exports, and no production code had ever called it: `HookExecutor.firePostOutbound` existed, was typed, was unit-tested, and had exactly one caller in the repository — its own test.

That is the worst shape a broken contract can take. Registering a `post_outbound` hook for delivery auditing, outbound metrics or reply logging raised no error and produced no warning. The hook was simply never invoked, and the instrumentation a consumer believed they had did not exist.

Every reply now leaves through one path that sends and then reports, so the hook fires exactly once per attempt with `{ event, outbound, result }` — including the EC-D auto-reply sent when a `pre_inbound` hook blocks with a message, and including the attempt that finds no adapter registered for the event's platform. That last case matters more than it looks: a hook counting deliveries would otherwise omit precisely the replies that went nowhere.

The hook observes; it does not intercept. The adapter's `SendResult` reaches the caller of `reply` unchanged, and a hook that throws is contained by `HookExecutor`, so a broken observer cannot turn a delivered reply into a failed one.
