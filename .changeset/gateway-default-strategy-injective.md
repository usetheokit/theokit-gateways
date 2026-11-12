---
"@theokit/gateway": patch
---

Fix `defaultStrategy` giving two different senders the same session key. Ids that differed only by `-` versus `_` (sender, channel or topic) collided. Ids are now escaped (`_` to `__`, `-` to `_d`), so distinct ids always give distinct keys. Note: the session key of any existing session whose id contains `_` or `-` changes, so consumers with stored sessions may need a one-time migration.
