---
"@theokit/gateway-email": patch
---

Tests now load against `nodemailer@9.1.1`: the vitest config inlines `mailparser`, whose ESM build imports `nodemailer/lib/addressparser` as a directory that Node's ESM resolver rejects when its nodemailer dependency is 9.x. The declared `nodemailer` range is unchanged. No runtime change.
