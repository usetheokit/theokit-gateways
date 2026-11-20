---
"@theokit/gateway-nextcloud-talk": minor
"@theokit/gateway-synology-chat": minor
---

The `nextcloudTalkChannel` and `synologyChatChannel` descriptors now declare `transport: "webhook"` with a `webhook.handle`, so a host mounts them with `createWebhookHandler`. Nextcloud Talk checks the signature headers over the raw body; Synology Chat checks the outgoing-webhook token in the form body. Statuses match the packages' own routes, and the Express listeners are unchanged.
