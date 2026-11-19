# @theokit/gateway-agent

## 0.3.0

### Minor Changes

- ff830ef: Add `createChatApprover`: asks an owner in the chat to `/approve`, `/approve always` or `/deny` a tool call and waits. Silence, a failed send, an unknown conversation and a second question in the same conversation all deny; non-owners are refused; the answer commands never reach the agent. Raises the `@theokit/gateway` peer floor to 0.19.0 for `parseChatCommand`.
- fb0519b: Add `createAgentHandler`, which answers a channel message with one SDK agent turn: exactly one reply (the answer, a no-answer text, or an error text), secrets masked across streamed frames, an optional ack reaction, and a typed `AgentTurnError` thrown after a failed turn so `on_error` hooks fire.
- f8c3b1d: Add `createTrigger`, which runs an agent on a signed webhook and posts the answer to a channel (401 on a bad signature, 400 for an oversized delivery id, 503 while the reply adapter is down, 200 for a repeated id, 202 while the run goes on in the background), and `frameUntrusted`, which wraps untrusted text in a tag with a forged closing tag escaped.

### Patch Changes

- b28c508: Raise the `@theokit/sdk` peer floor from `2.18.0` to `4.62.0`: `@theokit/sdk@2.18.0` publishes declarations that reference names it never defines, so a consumer at the old floor failed declaration checking (#584).

## 0.2.0

### Minor Changes

- 46e9a65: Add `gatewayDeliverPort` and `parseChannelTarget`: adapt gateway adapters to a scheduler's deliver port, masking secrets and rendering the text for the platform.

## 0.1.0

### Minor Changes

- 31e8f4b: First release: `runAgentText` runs one SDK agent turn to text with tool results framed as untrusted data, and `deliverText` renders text for the adapter's platform and sends it, resolving a short failure code instead of an error message.
