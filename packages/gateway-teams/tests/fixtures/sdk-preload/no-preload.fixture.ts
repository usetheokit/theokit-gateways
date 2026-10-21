/**
 * Negative control: imports the Teams SDK middleware only inside its test, so its record must read
 * false, and the test must then see the middleware loaded. If it did not, the recorder would be
 * reading a cache the import never fills, and every `false` it wrote would mean nothing.
 */
import { createRequire } from "node:module";

import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const SDK_MIDDLEWARE = require.resolve("@microsoft/teams.apps/dist/middleware/index.js");

it("sees the SDK middleware loaded after importing it inside the test", async () => {
  await import("@microsoft/teams.apps/dist/middleware/index.js");
  expect(SDK_MIDDLEWARE in require.cache).toBe(true);
});
