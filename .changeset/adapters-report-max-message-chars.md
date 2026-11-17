---
"@theokit/gateway-wecom": minor
"@theokit/gateway-yuanbao": minor
"@theokit/gateway-zalo": minor
"@theokit/gateway-zalo-personal": minor
"@theokit/gateway-buzz": minor
"@theokit/gateway-clickclack": minor
"@theokit/gateway-twitch": minor
"@theokit/gateway-nextcloud-talk": minor
"@theokit/gateway-irc": minor
---

Report `capabilities.maxMessageChars` from the splitter's limit. IRC leaves it undefined because its limit is in bytes. None of these adapters produces thread events, so `threads` stays `false`.
