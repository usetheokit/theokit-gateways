---
"@theokit/gateway-teams": patch
---

`teamsActivityVerifier` recognises a tenant-issued token only when its issuer is under the login
endpoint's path (`{loginEndpoint}/...`), so an issuer on a host that merely starts with the
endpoint's host name is not taken for an Entra one. Construction refuses a `cloud.loginEndpoint`
ending in a slash.
