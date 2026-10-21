---
"@theokit/gateway-discord": patch
---

A `plain` text full of markup characters no longer goes out as a message longer than the
platform allows. The text was split on its own length and escaped afterwards, and escaping can
double a part, so 995 copies of `*a` went to Discord as one 2985-character message and came back
`discord_50035`. A part whose escaped body passes the cap is now split again at half the cap.
`editMessage` sends the same parts, so an edit is refused as `edit_too_long` for exactly the texts
a send delivers as more than one message.
