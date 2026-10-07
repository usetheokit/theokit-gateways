---
"@theokit/gateway-teams": patch
---

`teamsActivityVerifier` now refuses some tokens before it asks the Teams SDK, so they cost no SDK
work. A token whose header names no `kid` is refused as `invalid_token`, since no genuine token
omits it. A token issued by an Entra tenant the verifier would refuse anyway (another tenant, or
any tenant when no `tenantId` is set) is refused with that tenant reason.
