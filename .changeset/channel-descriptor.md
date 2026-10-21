---
"@theokit/gateway": minor
"@theokit/gateway-telegram": minor
"@theokit/gateway-line": minor
---

Wire channels from descriptors, and keep the channels that connect when another cannot.

`@theokit/gateway` exports `createChannels` and the types `ChannelDescriptor`,
`ChannelConfigField`, `ChannelWebhook`, `WebhookRequest`, `IngestResult`, `ChannelEntry`,
`ChannelRejection` and `CreateChannelsResult`. `createChannels(entries)` builds an adapter per
entry and returns `{ adapters, rejected }`: an entry whose required field is absent, `null` or
`""` is rejected with a `GatewayConfigurationError` coded `missing_required_config` naming the
keys, and a configuration error thrown by the descriptor's `create` is rejected the same way. Any
other error propagates. It connects nothing and makes no network call.

`GatewayRunner` accepts `connectFailure: "rollback" | "isolate"` (exported as `ConnectFailure`),
and `StartResult` is exported.
The default, `"rollback"`, is unchanged: one failed connect disconnects the adapters that did
connect and rejects `start()`. Under `"isolate"`, `start()` connects every adapter, wires inbound
only for the ones that connected, and reports the rest with a redacted reason.

`start()` now resolves a `StartResult` (`{ connected, failed }`) instead of `void`, under both
values. This is a type change: code that awaits `start()` and ignores the value is unaffected,
but a structural type declaring `start(): Promise<void>` that a `GatewayRunner` is assigned to
fails with TS2322, and a subclass overriding `start()` with that signature fails with TS2416.

`@theokit/gateway-telegram` exports `telegramChannel`, a socket channel whose config has a
required, secret `token` and an optional `allowedUsers`, and a `ConfigurationError` (a
`GatewayConfigurationError` with the `gateway-telegram` prefix). Called directly,
`telegramChannel.create` refuses a token that is not a string or is empty, and an `allowedUsers`
that is not an array of strings; through `createChannels`, an absent or empty token is rejected
first, as `missing_required_config`.

`@theokit/gateway-line` exports `lineChannel`, a webhook channel whose `webhook.verify` checks the
`x-line-signature` header against the raw body and whose `webhook.ingest` dispatches a verified
payload through `dispatchWebhookBody`, so a reply uses the cached reply token, or answers
`"malformed"` without dispatching. It answers `"no_handler"` (a member of `IngestResult`) when the
payload holds a text message for the handler and none is subscribed: before the runner started,
after it stopped, or when LINE's connect failed under `"isolate"`. Before, such a request answered
`"delivered"`, a route acknowledged it, and LINE did not redeliver the lost message.
`lineChannel.create` checks field types before the adapter's constructor.

`LineAdapter.dispatchWebhookBody` now resolves `"ok" | "no_handler"` instead of `void`. It answers
`"no_handler"`, dispatching nothing and caching no reply token, for a batch holding a text message
that passes the mention guard while no handler is subscribed; an empty or follow-only batch still
answers `"ok"`. It reads the handler once per batch, so a handler that unsubscribes while handling
one event still receives the rest of the batch. Code that ignores the value is unaffected; a
subclass overriding the method with `Promise<void>` fails with TS2416. `createWebhookServer` is
unchanged and still answers 200 before it dispatches.

Both descriptors are typed locally and import nothing `@theokit/gateway` 0.9.0 lacks, so the peer
range stays `>=0.9.0 <1.0.0`.
