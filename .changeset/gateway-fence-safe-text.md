---
"@theokit/gateway": minor
---

Fenced code blocks survive translation and splitting.

`toDialect`, `rewriteMarkers` and every `channelRendering(...).translate` copy a fenced block
(markers, info string and code lines) byte for byte and rewrite only the text around it.
`chunkText` and `chunkByGrapheme` close a fence at a cut inside it and reopen it with the same
opening line in the next part, cutting at line ends and keeping every code line. Text with no fence
is split exactly as before. The new `findFences(text)` exports the scanner they share.
