# Markdown tables through translate and the splitters (B-556)

Measured at theokit-gateways commit `bc5e536` (before this change) for the ten platforms that have
a splitter. The same check is kept as `integration/tests/unit/table-splitting.test.ts`, which now
passes for all ten.

Method: a table of rows with `**bold**`, `` `code` `` and plain cells, once short and once longer
than the platform's limit (2.3 times), and a table whose rows alternate between a fifth of the limit
and 0.3, 0.55, 0.7 and 0.9 of it so that a long row straddles a cut. Each table went through
`channelRendering(platform).translate`, then the platform's splitter. A row counts as cut when its
translated text is not a whole line of any part.

| Platform | translate on a table | Splitter, table longer than the limit | Splitter, straddling row, at `bc5e536` |
| --- | --- | --- | --- |
| discord | identity | rows whole | row cut at 0.9 of the window |
| slack | emphasis rewritten cell by cell, pipes kept | rows whole | row cut at 0.9 |
| telegram | markers stripped cell by cell, pipes kept | rows whole | row cut at 0.9 |
| whatsapp | emphasis rewritten cell by cell | rows whole | row cut at 0.9 |
| teams | identity | rows whole | row cut at 0.9 |
| mattermost | identity | rows whole | row cut at 0.9 |
| irc | markers stripped cell by cell | one PRIVMSG per line, rows whole | none (a row over the budget is cut by bytes, as before) |
| line | markers stripped cell by cell | rows whole (B-556 earlier work) | none |
| sms | markers stripped cell by cell | rows whole (B-556 earlier work) | none |
| nextcloud_talk | identity | rows whole (B-556 earlier work) | none |

`translate` never changed a pipe or merged cells. Where the splitter cut a row (discord, slack,
telegram, whatsapp, teams, mattermost), `chunkText` and `splitForTelegram` searched for a newline
only in the second half of the window, so a long row that crossed the window edge was cut at a
space or at the edge. They now pass `keepTableRows` (Telegram has its own copy of the rule), and a
row that fits in a part moves whole to the next part. A row longer than a part is still cut by
length. Text with no table row is covered by tests that compare the output with the unchanged
algorithm.
