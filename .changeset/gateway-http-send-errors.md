---
"@theokit/gateway-google-chat": minor
"@theokit/gateway-nextcloud-talk": minor
"@theokit/gateway-synology-chat": minor
"@theokit/gateway-twitch": minor
---

Map HTTP send failures with `sendErrorFromHttp`: 429 is now `rate_limit` with `retryAfterMs`, 401 `auth_failed`, 403 `permission_denied`, 5xx `server_error`, and a rejected fetch `network_error`. The old codes move to `platformCode`: `google_chat_auth_error`, `google_chat_http_error`, `talk_unauthorized`, `talk_bad_request`, `talk_http_error`, `synology_api_error` and `twitch_api_error` (Synology body-level errors are now `platform_error`). Raises the `@theokit/gateway` peer floor to 0.25.0.
