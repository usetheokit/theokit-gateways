// Loaded with `node --import` before the script under test, so any process or network call the
// script makes fails loudly instead of running. `tools/tests/release-path.test.mjs` uses it to hold
// `tools/release-path.mjs` to its promise of reading and moving local files only.
//
// The CommonJS objects are patched, then `syncBuiltinESMExports()` copies the stubs into the ESM
// named exports, so `import { spawn } from "node:child_process"` sees them too.
//
// Not covered, and stated so nobody reads this as a sandbox: `process.binding` and native addons.

import childProcess from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import module from "node:module";
import net from "node:net";
import process from "node:process";
import tls from "node:tls";

function deny(name) {
  return function denied() {
    process.stderr.write(`denied-io ${name}\n`);
    throw new Error(`denied-io ${name}: this process may not make process or network calls`);
  };
}

const patches = [
  [childProcess, "child_process", ["spawn", "spawnSync", "exec", "execSync", "execFile"]],
  [childProcess, "child_process", ["execFileSync", "fork"]],
  [net, "net", ["connect", "createConnection"]],
  [net.Socket.prototype, "net.Socket.prototype", ["connect"]],
  [tls, "tls", ["connect"]],
  [dns, "dns", ["lookup"]],
  [dns.promises, "dns.promises", ["lookup"]],
  [http, "http", ["request", "get"]],
  [https, "https", ["request", "get"]],
  [dgram, "dgram", ["createSocket"]],
];

for (const [target, label, names] of patches) {
  for (const name of names) target[name] = deny(`${label}.${name}`);
}

for (const name of ["fetch", "WebSocket", "EventSource"]) {
  if (name in globalThis) globalThis[name] = deny(name);
}

module.syncBuiltinESMExports();
