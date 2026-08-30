---
"@theokit/gateway-whatsapp": patch
---

The unofficial (Web) bridge now exits on SIGTERM instead of hanging with Chromium still running.

Measured 2026-08-30: sending SIGTERM to the bridge did not stop it at all — the `exit` event never
fired and ten Chromium processes stayed up. puppeteer registers its own SIGTERM/SIGINT/SIGHUP
handlers by default, and registering any handler replaces Node's terminate-on-signal default; the
bridge installed none of its own, so it inherited a shutdown that waits on a browser close which
never arrives while WhatsApp Web is still loading.

Anything that supervises a process stops it with SIGTERM — systemd, Docker, pm2, a parent Node
process. Every such stop left a bridge that would not die and a leaked browser tree, recoverable
only with SIGKILL, which cannot close anything cleanly. Restarting therefore accumulated Chromium
processes and session directories.

The bridge now owns its termination signals and closes the browser under a five-second deadline,
then exits regardless. Re-measured on the same probe: the process exits in ~6s with code 0 and zero
Chromium processes survive.
