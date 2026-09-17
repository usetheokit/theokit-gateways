---
"@theokit/gateway-discord": minor
---

Export `splitForDiscord` from the package entry.

Seven of the eight packages that ship a splitter already re-exported it; `gateway-discord` was
the one that did not, which made Discord the only platform whose splitter an outside caller
could not reach. That matters now rather than as tidiness: B-019 puts the channel presenter
OUTSIDE these packages and forbids it from splitting, so a caller that must not re-split has to
be able to call the one the adapter already uses.

Additive — no existing export changes.
