---
"@theokit/gateway": minor
---

Add `jwksKeySet`, `decodeJwt` and `verifyRs256Jwt`: a JWKS key-set cache (max-age, shared in-flight read, unknown-kid refetch floor, stale-while-revalidate) and RS256 JWT signature verification for adapters whose platform signs requests with a JWT.
