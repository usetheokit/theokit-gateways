/**
 * Setup file for the nested run in
 * `tools/tests/gateway-teams-files-load-the-teams-sdk-before-any-hook.test.mjs`. Before a file's
 * own hooks, it appends `{ file, loaded, pid }` to the file `SDK_LOAD_RECORD_FILE` names: whether
 * the Teams SDK middleware is already in `require.cache`, and which worker process ran the file.
 * A file that reads `false` here pays the middleware's first import inside a hook or a test, so
 * inside a vitest budget.
 */

import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";

import { beforeAll, expect } from "vitest";

const recordFile = process.env.SDK_LOAD_RECORD_FILE;
if (recordFile === undefined) {
  throw new Error("record-sdk-load.setup.ts: SDK_LOAD_RECORD_FILE is not set");
}

const require = createRequire(import.meta.url);
const SDK_MIDDLEWARE = require.resolve("@microsoft/teams.apps/dist/middleware/index.js");

beforeAll(() => {
  const file = expect.getState().testPath;
  if (file === undefined) {
    throw new Error(
      "record-sdk-load.setup.ts: expect.getState().testPath is undefined in beforeAll, so this record cannot name its file",
    );
  }
  appendFileSync(
    recordFile,
    `${JSON.stringify({ file, loaded: SDK_MIDDLEWARE in require.cache, pid: process.pid })}\n`,
  );
});
