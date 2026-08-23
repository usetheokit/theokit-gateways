---
"@theokit/gateway-whatsapp": minor
---

**The `web` backend never started, and when it failed it said nothing useful.** Three defects, each hiding the next.

**It died before reaching a browser.** The bridge read `Client` and `LocalAuth` off the module namespace of `whatsapp-web.js`. That package ends its `module.exports` object with a spread, and `cjs-module-lexer` — which Node uses to synthesise named exports for a CommonJS module — cannot statically analyse an object built that way. It proved `Client` and gave up: measured on 1.34.7, `mod.LocalAuth` is `undefined` while `mod.default.LocalAuth` is a function. The API now comes off the default export, with a namespace fallback for a true-ESM module.

**It could not be found at all from the published package.** `defaultBridgeScriptPath()` walked `../../bridge/` from the module — correct in the source tree, where `src/backend/web/` up two is `src/`. The bundle is one flat file at `dist/index.js`, so the same walk landed on `packages/bridge/`, one directory above the package. The child died with `MODULE_NOT_FOUND`. Both layouts are now checked, and neither existing raises a named error instead of returning a path that cannot work.

**And every one of those failures surfaced as a timeout.** `connect()` raced only the `ready` promise; a bridge that reported exactly what was wrong had its message written to stderr and dropped. The caller paid the full `connectTimeoutMs` — two minutes by default — and received `WhatsAppConnectTimeoutError`, the one error carrying no cause. A reported failure now rejects `connect()` immediately with `WhatsAppBridgeError`, which is new and exported, and carries a machine-readable `code`: `peer_missing`, `peer_incompatible`, `peer_load_failed` or `bridge_script_missing`. The `IpcEvent` error arm carries that code too.

A package that is present but does not export what the bridge needs is now distinguished from one that is absent — telling a consumer to run `pnpm add` for a package they already have sends them the wrong way. `ERR_MODULE_NOT_FOUND` separates them.

**What this does not fix.** No browser is installed here, because `puppeteer` is absent from `pnpm.onlyBuiltDependencies`. That failure is now reported rather than crashed on, with Chrome's own install command in the message, but the backend still cannot reach WhatsApp. Tracked separately.

Minor rather than patch: `WhatsAppBridgeError` and `defaultBridgeScriptPath` join the public API, and `IpcEvent`'s error arm gains an optional `code`.

Nothing had ever executed any of this. Every test injected a fake child process, and the live suite excludes the web backend by declaration, so 132 green tests sat over a backend that could not start, could not be found, and could not say so. Seven tests now drive the real script and the real spawn — and each was checked by reverting the fix it covers and confirming it goes red.
