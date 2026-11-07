---
"@theokit/gateway": minor
"@theokit/gateway-discord": patch
"@theokit/gateway-slack": patch
"@theokit/gateway-teams": patch
"@theokit/gateway-telegram": patch
"@theokit/gateway-whatsapp": patch
"@theokit/gateway-mattermost": patch
---

Keep Markdown table rows whole when Discord, Slack, Teams, Telegram, WhatsApp and Mattermost split a long reply. A cut that fell inside a table row now moves back to the start of that row when the row fits in a part, so each row reaches the platform byte-identical. `chunkText` gains the opt-in `keepTableRows` option; text with no table row splits into the same chunks as before.
