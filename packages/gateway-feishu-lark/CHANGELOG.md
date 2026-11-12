# @theokit/gateway-feishu-lark

## 0.1.0

### Minor Changes

- 67e0b78: Add `@theokit/gateway-feishu-lark`, a Feishu / Lark adapter.

  `@theokit/gateway-feishu-lark` (first release) exports `FeishuLarkAdapter`, which receives
  `im.message.receive_v1` text messages over the open platform SDK's long connection and replies with
  `im.message.create` or `im.message.reply`, on Feishu or on Lark (`domain`). `connect()` proves the
  App ID and Secret with a tenant token and waits for the connection to come up; a redelivered event
  is answered once. The SDK keeps its own reconnect. `@larksuiteoapi/node-sdk` is an optional peer,
  and `@theokit/gateway` 0.12.0 or later is required. Not yet run against a live app.

### Patch Changes

- acc8f25: Refuse an outbound that carries images with `attachments_unsupported`, making no platform call,
  instead of sending its text and dropping the images. The same refusal answers an outbound with
  attachments on every adapter that sends text only.
