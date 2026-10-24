#!/usr/bin/env node
// Which path the release workflow takes, decided the way changesets itself would.
//
// `changesets/action` (pinned at a45c4d5 in .github/workflows/release.yml) takes the version path
// whenever any file sits in `.changeset/`, and never reads `ignore`. With only ignored-package
// changesets pending, `changeset version` changes nothing, the Version Packages pull request has no
// commits, and `changeset publish` never runs (run 39953987046). This script answers the question
// the action does not ask: is anything pending releasable?
//
//   node tools/release-path.mjs <changesetDir> [--set-aside <dir>]
//
// prints `path=publish` or `path=version` on its first line. With `--set-aside` and the publish
// path, it moves every changeset that releases nothing into <dir>, printing `set-aside <name>` per
// file, so the action finds no pending file and publishes. On the version path it moves nothing.
// It reads and moves local files only: no git, no network.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const BUMPS = new Set(["major", "minor", "patch", "none"]);
const GLOB_CHARACTERS = /[*?[\]{}!]/;
// A bare name cannot start with `@`: YAML reserves it, so changesets refuses it too.
const RELEASE_LINE = /^(?:"([^"]+)"|'([^']+)'|([^\s"'@:][^\s"':]*))\s*:\s*(\S+)$/;

export class ReleasePathError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReleasePathError";
  }
}

function readIgnore(changesetDir) {
  const configPath = join(changesetDir, "config.json");
  if (!existsSync(configPath)) {
    throw new ReleasePathError(`${configPath}: no changesets config in ${changesetDir}`);
  }
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new ReleasePathError(`${configPath}: not valid JSON (${error.message})`);
  }
  const ignore = config.ignore ?? [];
  if (!Array.isArray(ignore) || ignore.some((entry) => typeof entry !== "string")) {
    throw new ReleasePathError(`${configPath}: "ignore" must be a list of package names`);
  }
  const glob = ignore.find((entry) => GLOB_CHARACTERS.test(entry));
  if (glob !== undefined) {
    throw new ReleasePathError(
      `${configPath}: ignore entry "${glob}" is a glob; only exact package names are supported`,
    );
  }
  return new Set(ignore);
}

// The files `@changesets/read` reads: Markdown, not a dotfile, not a readme in any letter case.
function pendingChangesets(changesetDir) {
  return readdirSync(changesetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith(".") && name.toLowerCase() !== "readme.md")
    .sort();
}

function parseRelease(line, file) {
  const match = line.match(RELEASE_LINE);
  if (match === null) {
    throw new ReleasePathError(`${file}: malformed front matter line "${line}"`);
  }
  const [, doubleQuoted, singleQuoted, bare, bump] = match;
  if (!BUMPS.has(bump)) {
    throw new ReleasePathError(`${file}: unknown bump "${bump}" in front matter line "${line}"`);
  }
  return doubleQuoted ?? singleQuoted ?? bare;
}

// The package names a changeset releases: the lines between its first two `---` lines.
function releasedPackages(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (lines[0]?.trim() !== "---" || close === -1) {
    throw new ReleasePathError(`${file}: no front matter between two "---" lines`);
  }
  return lines
    .slice(1, close)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => parseRelease(line, file));
}

function classify(changesetDir) {
  const ignore = readIgnore(changesetDir);
  const releasable = [];
  const nonReleasable = [];
  for (const name of pendingChangesets(changesetDir)) {
    const packages = releasedPackages(join(changesetDir, name));
    const releases = packages.some((pkg) => !ignore.has(pkg));
    (releases ? releasable : nonReleasable).push(name);
  }
  return { releasable, nonReleasable };
}

/** The pending changesets that name at least one package outside `ignore`. */
export function releasableChangesets(changesetDir) {
  return classify(changesetDir).releasable;
}

/** The pending changesets that release nothing: every package ignored, or none named. */
export function nonReleasableChangesets(changesetDir) {
  return classify(changesetDir).nonReleasable;
}

/** `version` when anything pending is releasable, `publish` otherwise. */
export function releasePath(changesetDir) {
  return releasableChangesets(changesetDir).length > 0 ? "version" : "publish";
}

function isInside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  const escapes = path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
  return !escapes;
}

function move(from, to) {
  try {
    renameSync(from, to);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

function setAside(changesetDir, names, target) {
  const collision = names.map((name) => join(target, name)).find((path) => existsSync(path));
  if (collision !== undefined) {
    throw new ReleasePathError(`${collision}: already exists; refusing to overwrite it`);
  }
  try {
    mkdirSync(target, { recursive: true });
  } catch (error) {
    throw new ReleasePathError(`${target}: cannot create the set-aside directory (${error.code})`);
  }
  for (const name of names) {
    move(join(changesetDir, name), join(target, name));
    process.stdout.write(`set-aside ${name}\n`);
  }
}

function parseArguments(args) {
  const [changesetDir, flag, target, ...extra] = args;
  const valid =
    changesetDir !== undefined &&
    extra.length === 0 &&
    (flag === undefined || (flag === "--set-aside" && target !== undefined));
  if (!valid) {
    throw new ReleasePathError(
      "usage: node tools/release-path.mjs <changesetDir> [--set-aside <dir>]",
    );
  }
  if (target !== undefined && isInside(changesetDir, target)) {
    throw new ReleasePathError(`${target}: the set-aside directory is inside ${changesetDir}`);
  }
  return { changesetDir, target };
}

function main(args) {
  const { changesetDir, target } = parseArguments(args);
  const path = releasePath(changesetDir);
  process.stdout.write(`path=${path}\n`);
  if (path === "publish" && target !== undefined) {
    setAside(changesetDir, nonReleasableChangesets(changesetDir), target);
  }
}

function invokedDirectly() {
  const entry = process.argv[1];
  return (
    entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  );
}

if (invokedDirectly()) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof ReleasePathError)) throw error;
    process.stderr.write(`release-path: ${error.message}\n`);
    process.exit(1);
  }
}
