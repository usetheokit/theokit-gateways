---
"@theokit/gateway": minor
---

Add `parseChatCommand`, `commandHook` and `helpText`: one `pre_inbound` hook that strips a leading mention and `@bot` suffix, matches commands exactly and answers `/help`.
