# @theokit/gateway-agent

## 0.2.0

### Minor Changes

- 46e9a65: Add `gatewayDeliverPort` and `parseChannelTarget`: adapt gateway adapters to a scheduler's deliver port, masking secrets and rendering the text for the platform.

## 0.1.0

### Minor Changes

- 31e8f4b: First release: `runAgentText` runs one SDK agent turn to text with tool results framed as untrusted data, and `deliverText` renders text for the adapter's platform and sends it, resolving a short failure code instead of an error message.
