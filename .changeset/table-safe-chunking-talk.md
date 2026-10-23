---
"@theokit/gateway-nextcloud-talk": patch
---

`splitForTalk` no longer cuts a Markdown table row in two at a part boundary. When a cut would
fall inside a row that fits in one part, the part ends before that row and the row starts the next
part. A row longer than a part is still cut by length. Every character is kept, every part stays
within the limit in code points, and text with no table row splits exactly as before. Two rows
that each fill a part exactly arrive as three parts, the second holding only the line ending
between them.

No export, signature, dependency or peer range changes.
