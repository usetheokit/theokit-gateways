// The release workflow must reach `changeset publish` when the only changesets left in
// `.changeset/` name packages the config ignores. Run 39953987046 (2026-10-23) took the version
// path instead: `changesets/action` at a45c4d5 decides by `changesets.length !== 0` and never
// reads `ignore`, so `changeset version` changed nothing, the Version Packages pull request had no
// commits, and nothing was published. `tools/release-path.mjs` makes the decision the action
// cannot, and these tests hold it to the changesets format.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = join(repoRoot, "tools/release-path.mjs");
const preloadUrl = new URL("./fixtures/deny-process-and-network.mjs", import.meta.url).href;

const ALLOWED_IMPORTS = ["node:fs", "node:path", "node:url", "node:process"];

async function loadScript() {
  expect(existsSync(scriptPath), "tools/release-path.mjs must exist").toBe(true);
  return import(pathToFileURL(scriptPath).href);
}

async function decide(changesetDir) {
  return (await loadScript()).releasePath(changesetDir);
}

let scratch;
afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function changeset(...releases) {
  return `---\n${releases.join("\n")}\n---\n\nA change.\n`;
}

// A `.changeset/` directory in a fresh temporary directory, with `config` as its config.json
// (omitted when null) and `files` as name -> content.
function changesetDir({ ignore = [], config, files = {} } = {}) {
  scratch = mkdtempSync(join(tmpdir(), "release-path-"));
  const dir = join(scratch, ".changeset");
  mkdirSync(dir);
  const configText = config === undefined ? JSON.stringify({ baseBranch: "main", ignore }) : config;
  if (configText !== null) writeFileSync(join(dir, "config.json"), configText);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function runCli(args, { preload = false } = {}) {
  const nodeArgs = preload ? ["--import", preloadUrl] : [];
  return spawnSync(process.execPath, [...nodeArgs, ...args], { encoding: "utf8" });
}

function snapshot(dir) {
  return readdirSync(dir)
    .sort()
    .map((name) => [name, readFileSync(join(dir, name), "utf8")]);
}

// The package names a changeset's front matter releases, read the simplest way that works on
// this repository's files; the script's own parser is what the other cases test.
function releasedPackages(text) {
  const [, frontMatter = ""] = text.split(/^---\s*$/m);
  return frontMatter
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^["']?([^"':]+)["']?\s*:/)?.[1])
    .filter((name) => name !== undefined);
}

const ONLY_IGNORED = { ignore: ["@theokit/gateway-signal"] };
const SIGNAL_MINOR = changeset('"@theokit/gateway-signal": minor');
const CORE_PATCH = changeset('"@theokit/gateway": patch');

describe("the release path decision", () => {
  it("is publish when every pending changeset names only ignored packages", async () => {
    const dir = changesetDir({ ...ONLY_IGNORED, files: { "gateway-signal.md": SIGNAL_MINOR } });
    expect(await decide(dir)).toBe("publish");
  });

  it("is publish for the repository config and its ignored-package changesets", async () => {
    const source = join(repoRoot, ".changeset");
    const config = readFileSync(join(source, "config.json"), "utf8");
    const ignore = new Set(JSON.parse(config).ignore);
    const files = {};
    for (const name of readdirSync(source).filter((n) => n.endsWith(".md") && n !== "README.md")) {
      const text = readFileSync(join(source, name), "utf8");
      const released = releasedPackages(text);
      if (released.length > 0 && released.every((pkg) => ignore.has(pkg))) files[name] = text;
    }
    // An empty set is publish too (EC-2): the case holds after the five are consumed.
    expect(await decide(changesetDir({ config, files }))).toBe("publish");
  });

  it("is version when one pending changeset names a package outside ignore", async () => {
    const files = { "gateway-signal.md": SIGNAL_MINOR, "core.md": CORE_PATCH };
    expect(await decide(changesetDir({ ...ONLY_IGNORED, files }))).toBe("version");
  });

  it("is publish when no changeset is pending", async () => {
    expect(await decide(changesetDir(ONLY_IGNORED))).toBe("publish");
  });
});

describe("the releasable and non-releasable lists", () => {
  it("counts a changeset naming ignored and other packages as releasable", async () => {
    const mixed = changeset('"@theokit/gateway": patch', '"@theokit/gateway-signal": patch');
    const dir = changesetDir({ ...ONLY_IGNORED, files: { "mixed.md": mixed } });
    const script = await loadScript();
    expect(script.releasableChangesets(dir)).toEqual(["mixed.md"]);
    expect(script.releasePath(dir)).toBe("version");
  });

  it("counts a none bump on a package outside ignore as releasable", async () => {
    const files = { "none.md": changeset('"@theokit/gateway": none') };
    const script = await loadScript();
    expect(script.releasableChangesets(changesetDir({ ...ONLY_IGNORED, files }))).toEqual([
      "none.md",
    ]);
  });

  it("lists an empty changeset as non-releasable", async () => {
    const dir = changesetDir({ ...ONLY_IGNORED, files: { "empty.md": "---\n---\n\nNothing.\n" } });
    const script = await loadScript();
    expect(script.nonReleasableChangesets(dir)).toEqual(["empty.md"]);
    expect(script.releasePath(dir)).toBe("publish");
  });

  it("skips dotfiles and a readme in any case", async () => {
    const files = { ".hidden.md": CORE_PATCH, "readme.md": CORE_PATCH, "README.md": CORE_PATCH };
    const dir = changesetDir({ ...ONLY_IGNORED, files });
    const script = await loadScript();
    expect(script.releasableChangesets(dir)).toEqual([]);
    expect(script.nonReleasableChangesets(dir)).toEqual([]);
  });

  it("parses crlf and single-quoted front matter", async () => {
    const files = { "crlf.md": "---\r\n'@theokit/gateway-signal': minor\r\n---\r\n\r\nText.\r\n" };
    const script = await loadScript();
    expect(script.nonReleasableChangesets(changesetDir({ ...ONLY_IGNORED, files }))).toEqual([
      "crlf.md",
    ]);
  });
});

describe("the refusals", () => {
  it("refuses a missing config naming the directory", async () => {
    const dir = changesetDir({ config: null, files: { "a.md": CORE_PATCH } });
    const script = await loadScript();
    expect(() => script.releasePath(dir)).toThrow(script.ReleasePathError);
    expect(() => script.releasePath(dir)).toThrow(join(dir, "config.json"));
  });

  it("refuses malformed front matter naming the file", async () => {
    const dir = changesetDir({ ...ONLY_IGNORED, files: { "broken.md": "no front matter\n" } });
    const script = await loadScript();
    expect(() => script.releasePath(dir)).toThrow(script.ReleasePathError);
    expect(() => script.releasePath(dir)).toThrow(/broken\.md.*front matter/);
  });

  it("refuses an unknown bump naming the file", async () => {
    const files = { "odd.md": changeset('"@theokit/gateway": huge') };
    const script = await loadScript();
    expect(() => script.releasePath(changesetDir({ ...ONLY_IGNORED, files }))).toThrow(
      /odd\.md.*huge/,
    );
  });

  it("refuses an ignore entry with a glob naming the entry", async () => {
    const dir = changesetDir({ ignore: ["@theokit/gateway-*"], files: { "a.md": CORE_PATCH } });
    const script = await loadScript();
    expect(() => script.releasePath(dir)).toThrow(script.ReleasePathError);
    expect(() => script.releasePath(dir)).toThrow("@theokit/gateway-*");
  });
});

describe("the command line", () => {
  it("prints the path on its first line", () => {
    expect(existsSync(scriptPath), "tools/release-path.mjs must exist").toBe(true);
    const dir = changesetDir({ ...ONLY_IGNORED, files: { "core.md": CORE_PATCH } });
    const run = runCli([scriptPath, dir]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.split("\n")[0]).toBe("path=version");
  });

  it("sets aside only non-releasable files on the publish path", () => {
    expect(existsSync(scriptPath), "tools/release-path.mjs must exist").toBe(true);
    const files = { "gateway-signal.md": SIGNAL_MINOR, "README.md": "# Changesets\n" };
    const dir = changesetDir({ ...ONLY_IGNORED, files });
    const target = join(scratch, "set-aside");
    const run = runCli([scriptPath, dir, "--set-aside", target]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe("path=publish\nset-aside gateway-signal.md\n");
    expect(readdirSync(target)).toEqual(["gateway-signal.md"]);
    expect(readdirSync(dir).sort()).toEqual(["README.md", "config.json"]);
  });

  it("moves nothing on the version path", () => {
    expect(existsSync(scriptPath), "tools/release-path.mjs must exist").toBe(true);
    const files = { "gateway-signal.md": SIGNAL_MINOR, "core.md": CORE_PATCH };
    const dir = changesetDir({ ...ONLY_IGNORED, files });
    const before = snapshot(dir);
    const run = runCli([scriptPath, dir, "--set-aside", join(scratch, "set-aside")]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe("path=version\n");
    expect(snapshot(dir)).toEqual(before);
  });

  it("refuses a set-aside directory inside the changeset directory", () => {
    expect(existsSync(scriptPath), "tools/release-path.mjs must exist").toBe(true);
    const dir = changesetDir({ ...ONLY_IGNORED, files: { "gateway-signal.md": SIGNAL_MINOR } });
    const run = runCli([scriptPath, dir, "--set-aside", join(dir, "aside")]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(join(dir, "aside"));
    expect(readdirSync(dir).sort()).toEqual(["config.json", "gateway-signal.md"]);
  });

  it("refuses to overwrite a file in the set-aside directory", () => {
    expect(existsSync(scriptPath), "tools/release-path.mjs must exist").toBe(true);
    const dir = changesetDir({ ...ONLY_IGNORED, files: { "gateway-signal.md": SIGNAL_MINOR } });
    const target = join(scratch, "set-aside");
    mkdirSync(target);
    writeFileSync(join(target, "gateway-signal.md"), "already here\n");
    const run = runCli([scriptPath, dir, "--set-aside", target]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(join(target, "gateway-signal.md"));
    expect(readFileSync(join(target, "gateway-signal.md"), "utf8")).toBe("already here\n");
    expect(existsSync(join(dir, "gateway-signal.md"))).toBe(true);
  });
});

describe("no process or network call (NFR-001)", () => {
  it("makes no process or network call under the deny preload", () => {
    expect(existsSync(scriptPath), "tools/release-path.mjs must exist").toBe(true);
    const files = { "gateway-signal.md": SIGNAL_MINOR, "empty.md": "---\n---\n" };
    const dir = changesetDir({ ...ONLY_IGNORED, files });
    const run = runCli([scriptPath, dir, "--set-aside", join(scratch, "aside")], { preload: true });
    expect(run.stderr).not.toContain("denied-io");
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.split("\n")[0]).toBe("path=publish");
  });

  it("the deny preload refuses an aliased fetch and a git spawn", () => {
    scratch = mkdtempSync(join(tmpdir(), "release-path-"));
    const probes = {
      "fetch.mjs": 'const f = globalThis["fe" + "tch"];\nawait f("http://127.0.0.1:9");\n',
      "git.mjs":
        'import { execFileSync } from "node:child_process";\nexecFileSync("git", ["--version"]);\n',
    };
    for (const [name, source] of Object.entries(probes)) {
      writeFileSync(join(scratch, name), source);
      const run = runCli([join(scratch, name)], { preload: true });
      expect(run.status, `${name} ran past the preload`).not.toBe(0);
      expect(run.stderr).toContain("denied-io");
    }
  });

  it("imports only four node builtins", () => {
    expect(existsSync(scriptPath), "tools/release-path.mjs must exist").toBe(true);
    const source = readFileSync(scriptPath, "utf8");
    const specifiers = [...source.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) expect(ALLOWED_IMPORTS).toContain(specifier);
    expect(source).not.toMatch(/\brequire\s*\(|process\.binding|getBuiltinModule/);
  });
});
