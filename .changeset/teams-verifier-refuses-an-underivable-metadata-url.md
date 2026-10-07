---
"@theokit/gateway-teams": patch
---

`teamsActivityVerifier` throws a `TypeError` naming `cloud.openIdMetadataUrl` when the URL does not
end in `/openidconfiguration`. The Bot Framework key-set URL is that URL with the suffix replaced
by `/keys`, so a URL ending otherwise (the OIDC-standard `/.well-known/openid-configuration`, a
trailing slash, a query string) used to be fetched as the key set, and every request was refused as
`key_set_unavailable`, a retryable answer, for as long as the configuration stood. The Teams SDK's
own cloud values are unaffected.
