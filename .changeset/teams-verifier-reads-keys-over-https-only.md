---
"@theokit/gateway-teams": patch
---

`teamsActivityVerifier` refuses at construction a `cloud` endpoint that is not an `https:` URL,
with a `TypeError` naming the field; `http:` is accepted only on `localhost`, `127.0.0.1` and
`[::1]`. It reads a key set with `redirect: "error"`, so a key endpoint that answers with a
redirect is a failed read (`key_set_unavailable`) rather than a read of whatever URL it names.
