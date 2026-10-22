---
"@theokit/gateway": minor
---

`rawBodyCapture(tag, { maxBytes })` refuses a body larger than `maxBytes` bytes before holding it.
A declared `content-length` over the limit is refused before any byte is read; a streamed body is
refused once it passes the limit, and the rest of the stream is dropped. Either way `next` gets an
error carrying `status: 413`, which Express answers as 413. Without the option the middleware keeps
no limit, as before. `RawBodyCaptureOptions` is exported.
