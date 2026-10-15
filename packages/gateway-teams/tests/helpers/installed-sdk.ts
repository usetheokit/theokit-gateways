/**
 * The Teams SDK line installed as `@microsoft/teams.apps`. The package installs 2.0.x, and the CI
 * peer-major job overrides it to 2.1.x, so a test whose expectation depends on the installed line
 * reads it here instead of assuming 2.0.x.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** The installed `@microsoft/teams.apps` version. */
export const INSTALLED_SDK_VERSION = (
  require("@microsoft/teams.apps/package.json") as { version: string }
).version;

/** The installed SDK line: 2.0.x has no validator path for a tenant-issued token, 2.1.x has one. */
export const INSTALLED_SDK_LINE: "2.0.x" | "2.1.x" = INSTALLED_SDK_VERSION.startsWith("2.0.")
  ? "2.0.x"
  : "2.1.x";
