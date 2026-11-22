---
"@theokit/gateway": minor
---

Add `reportDiagnostic(tag, message, options?)` and `ReportDiagnosticOptions`: one place that redacts a diagnostic line and writes `[tag] message` to stderr. Every diagnostic line in core now goes through it, so a handler error that echoes a token is redacted in `BasePlatformAdapter.runHandler` and the Weixin connect failure too.
