---
"@theokit/gateway": patch
"@theokit/gateway-line": patch
"@theokit/gateway-sms": patch
---

Keep Markdown table rows intact through translation and splitting.

`channelRendering(platform).translate` and `toDialect` now rewrite a table row (a line whose first
non-blank character is `|`) one cell at a time. Before, an emphasis span could open in one cell
and close in the next, so `| 2 x *a | b* y |` lost both stars on the ten platforms that rewrite
markers. Text where no span crosses a row's pipe translates exactly as before. A lone `\r` counts
as a line ending, as in GFM. Inline code that holds an unescaped pipe inside a row is split at
that pipe, as GFM splits the cell, so its backticks no longer pair and the platforms that strip
markers now keep them.

`splitForLine` and `splitForSMS` no longer cut a table row in two at a part
boundary. When a cut would fall inside a row that fits in one part, the part ends before that row
and the row starts the next part. A row longer than a part is still cut by length. Every
character is kept, and every part stays within its limit (with the `(i/N) ` prefix counted on
SMS, whose numbering follows the new part count) except a single grapheme longer than the limit,
which is emitted whole as its own part, as before. Text with no table row splits exactly as
before. Two rows that each fill a part exactly arrive as three parts, the second holding only the
line ending between them.

No export, signature, dependency or peer range changes.
