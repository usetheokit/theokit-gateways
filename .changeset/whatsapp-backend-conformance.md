---
"@theokit/gateway-whatsapp": minor
---

**The `WhatsAppBackend` contract now says what it requires, and all three implementations are held to it at once.**

The interface declared bare signatures with no prose, so each backend answered the unasked questions its own way — and they diverged. `send()` on a disconnected backend refused in web (`"Bridge not connected."`) and in Baileys (`"Baileys backend is not connected."`), and **posted anyway** in Cloud. A consumer swapping backends, which is the single thing this seam exists to allow, would have found their unconnected sends leaving the process: for Cloud, a real request carrying a credential nothing had verified, or one `connect()` had already rejected.

Three changes, in the order that matters:

- **The contract is written down.** `connect()` is idempotent and returns `false` rather than throwing; `disconnect()` is idempotent and safe on a backend that never connected; `send()` requires a successful `connect()` and refuses without one, without touching the transport.
- **`not_connected` is its own error code.** Two backends called this state `server_error` and one had no opinion. A caller branches on the code, and a conformance test can only assert on one — so three descriptions of one state is the divergence, not a detail. **This widens the error union**, so an exhaustive `switch` stops compiling until the case is handled.
- **A conformance suite runs the contract against every implementation.** A per-backend test proves one implementation does something; only a shared one proves they do the *same* thing, and the substitutability is the product. A fourth backend inherits it by being added to the table, which is where someone decides whether it complies rather than discovering later that it does not.

Verified by mutation: making any one of the three diverge fails the suite.
