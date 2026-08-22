---
"@theokit/gateway-line": patch
"@theokit/gateway-sms": patch
---

**A webhook dispatch that rejects no longer ends the process.** Both servers answer the provider before running the handler — deliberately, because LINE and the SMS providers retry a webhook they did not see a 200 for, and waiting on a slow handler turns latency into a duplicate delivery. The cost of answering early is that the dispatch is floated, and a floated rejection is an unhandled one, which terminates Node. It is now caught and written to stderr.

This is the same defect that was fixed across the other adapters in #41; these two were missed because the gate that catches it only recognised the shape `void this.…`, and both float through a local (`void adapter.dispatch…`). The gate now matches any floated call, which is how these two surfaced.
