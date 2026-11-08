---
"@theokit/gateway": minor
"@theokit/gateway-sms": patch
"@theokit/gateway-line": patch
"@theokit/gateway-twitch": patch
"@theokit/gateway-tlon-urbit": patch
---

`@theokit/gateway` exports `SeenIds` (a bounded set of delivered ids) and `splitKeepingRows` (a
grapheme-safe split that keeps Markdown table rows whole). The SMS, LINE, Twitch and Tlon Urbit
adapters import them instead of carrying copies; their peer floor is now `>=0.13.0`.
