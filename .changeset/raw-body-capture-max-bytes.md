---
"@theokit/gateway": minor
---

`rawBodyCapture(tag, { maxBytes })` refuses a body larger than `maxBytes` bytes before holding it.
A declared `content-length` over the limit is refused before any byte is kept; a streamed body is
refused once it passes the limit. Either way the rest of the stream is dropped, and when it ends
the middleware answers 413 with the JSON body `{ "error": "request body too large" }` and one
stderr line naming the router. `next` is not called, so no error reaches Express's final handler,
which would answer with an HTML page carrying the stack outside production. The middleware
answers once: data, the end of the stream or a stream error after a refusal do nothing. A
`maxBytes` that is not a finite number of zero or more throws a `RangeError` when the middleware is
built. Without the option the middleware keeps no limit, as before. `RawBodyCaptureOptions` is
exported.
