---
"@theokit/gateway": minor
"@theokit/gateway-telegram": minor
"@theokit/gateway-slack": minor
"@theokit/gateway-mattermost": minor
"@theokit/gateway-whatsapp": minor
"@theokit/gateway-discord": minor
"@theokit/gateway-matrix": minor
"@theokit/gateway-teams": minor
"@theokit/gateway-line": minor
---

`MessageEvent` gains an optional `addressed` flag, set by these adapters on group and thread events whether or not `requireMention` is on, and `@theokit/gateway` adds `groupActivationHook({ mode, modeFor? })`, which blocks unaddressed group messages per chat.
