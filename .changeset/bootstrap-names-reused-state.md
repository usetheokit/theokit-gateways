---
"@theokit/gateway": patch
---

**The integration bootstrap scripts now name reused container state as the cause.** Both create a server and then create accounts inside it, so both are idempotent only against a *fresh* container. Run either against one that survived a previous run and it fails in a voice that does not name the cause — and Matrix's is actively misleading:

```
matrix:      register theokit-bot failed: {… "error":"Invalid registration token"}
mattermost:  create first user failed (400): An account with that username already exists.
```

The token was read from the log and sent correctly. It is "invalid" only because the server consumed it at its first boot, so the message sends the reader hunting the one thing that is not wrong. Measured: two round-trips before the remedy — a `:down` — became obvious, and the remedy is one command.

Each failure now prints it, and only when the failure actually matches a reused-state signature. Attaching the advice to every failure would send someone to recreate a container over a network blip and would train them to skip the line, which is how a helpful message becomes noise.

The decision is a pure function with its own tests, kept out of both scripts: the scripts boot containers and call `process.exit`, so they are untestable by construction, and "is this reused state?" is the only part with a right answer.
