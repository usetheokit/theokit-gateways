# @theokit/gateway-agent

## 0.6.0

### Minor Changes

- 32dc69c: `createEventRun` accepts `announce` (a masked line sent before the run) and `formatReply` (builds the delivered message from the answer and the event's attributes).

## 0.5.0

### Minor Changes

- 99fa568: New `createBroadcastGroups`: several channels answer as one conversation, with a bounded shared transcript, turns serialized per group, and the answer delivered to every other member.
- ca5aeb5: `progressFor(capabilities, overrides?)` returns an `AgentHandlerOptions.progress` function that picks how much progress to show from `capabilities.edit`, with per-event-kind overrides.
- f5f4835: New `createEventRun`: run an agent with no tools on an event that did not arrive over HTTP, frame the body with `frameUntrusted`, and deliver the summary to a chat. `createTrigger` now uses it.

## 0.4.0

### Minor Changes

- b047f80: `createAgentHandler` gains `decorateReply`, `onTurnEnd` and `onTurnStart`: append text to the single reply, observe each turn's final text, failure and usage, and reach the running turn by session.

## 0.3.2

### Patch Changes

- 6d42c80: Widen the `@theokit/sdk` peer range to `>=5.3.0 <10` so npm admits SDK 6, 7, 8 and 9.

## 0.3.1

### Patch Changes

- f573ef6: Raise the `@theokit/sdk` peer floor from `4.62.0` to `5.3.0`. Every `@theokit/presenter` the package admits (`>=0.10.0`) requires `@theokit/sdk@^5.3.0`, so an sdk below 5.3.0 installed no presenter the package accepts.

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
