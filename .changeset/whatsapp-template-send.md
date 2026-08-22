---
"@theokit/gateway-whatsapp": minor
---

**`WhatsAppCloudBackend.sendTemplate()` — the send that reaches someone who has not written first.**

The adapter could only send `type: "text"`, and Meta refuses free-form text more than 24 hours after the recipient last replied. That excluded every notification use case, and it made the integration impossible to check unattended: the live suite's outbound test asserted success while its own comment admitted it would fail on policy, so a red run meant "the recipient has not written recently" as often as it meant "something is broken".

Templates carry no such condition. `hello_world` is pre-approved on every WhatsApp Business account, so validating outbound now needs nothing arranged by hand.

It is deliberately **not** on the `WhatsAppBackend` interface. WhatsApp Web has no concept of templates, and widening the shared contract would hand the web backend a method it could only throw from. Reach it by holding `WhatsAppCloudBackend` directly.

`components` is omitted from the payload when absent rather than sent empty, because Meta rejects `components: []` on a template that declares no variables. The POST-and-interpret half of `sendText` moved into a shared `postMessage` rather than being copied.

The live outbound test now checks the template send, and the free-form text test asserts the pair it can honestly assert: either the message went out, or Meta refused it for the one documented policy reason and the mapper reported `session_window_expired`. An auth failure, a malformed payload or an unrecognised code still fail, and are now distinguishable from a recipient who simply has not written lately.
