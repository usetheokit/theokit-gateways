// `changeset version` refuses a changeset that names an ignored package beside one it versions
// ("Found mixed changeset ... Mixed changesets that contain both ignored and not ignored packages
// are not allowed"), and the release cut stops there. ADR-0009 keeps packages in `ignore` until
// the core they need is on npm, so every changeset has to name ignored packages alone or not at all.
// This guard reads the two inputs that refusal depends on, so the next mixed file fails CI on the
// commit that adds it instead of at a release cut.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repositoryChangesetDir = fileURLToPath(new URL("../../.changeset/", import.meta.url));

const BUMPS = new Set(["major", "minor", "patch", "none"]);
const GLOB_CHARACTERS = /[*?[{!]/;
// A bare name cannot start with `@`: YAML reserves it, so changesets refuses it too.
const RELEASE_LINE = /^(?:"([^"]+)"|'([^']+)'|([^\s"'@:][^\s"':]*))\s*:\s*(\S+)$/;

function readIgnore(changesetDir) {
  const configPath = join(changesetDir, "config.json");
  let text;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    throw new Error(`${configPath}: no changesets config in ${changesetDir} (${error.code})`);
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(`${configPath}: not valid JSON (${error.message})`);
  }
  const { ignore } = config;
  if (!Array.isArray(ignore) || ignore.some((entry) => typeof entry !== "string")) {
    throw new Error(`${configPath}: "ignore" must be a list of package names`);
  }
  const glob = ignore.find((entry) => GLOB_CHARACTERS.test(entry));
  if (glob !== undefined) {
    throw new Error(
      `${configPath}: ignore entry "${glob}" is a glob; only exact package names are supported`,
    );
  }
  return new Set(ignore);
}

function parseRelease(line, file) {
  const match = RELEASE_LINE.exec(line);
  if (match === null) {
    throw new Error(`${file}: malformed front matter line "${line}"`);
  }
  const [, doubleQuoted, singleQuoted, bare, bump] = match;
  if (!BUMPS.has(bump)) {
    throw new Error(`${file}: unknown bump "${bump}" in front matter line "${line}"`);
  }
  return doubleQuoted ?? singleQuoted ?? bare;
}

// The package names a changeset releases: the lines between its first two `---` lines.
function releasedPackages(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (lines[0]?.trim() !== "---" || close === -1) {
    throw new Error(`${file}: no front matter between two "---" lines`);
  }
  return lines
    .slice(1, close)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => parseRelease(line, file));
}

/** The sorted names of pending changesets that name an ignored and a versioned package. */
function mixedChangesets(changesetDir) {
  const ignored = readIgnore(changesetDir);
  return readdirSync(changesetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith(".") && name.toLowerCase() !== "readme.md")
    .filter((name) => {
      const names = releasedPackages(join(changesetDir, name));
      return names.some((n) => ignored.has(n)) && names.some((n) => !ignored.has(n));
    })
    .sort();
}

describe("pending changesets", () => {
  it("the_repository_lists_no_mixed_changeset", () => {
    expect(mixedChangesets(repositoryChangesetDir)).toEqual([]);
  });
});

describe("mixedChangesets", () => {
  let dir;

  function fixture(ignore, files) {
    dir = mkdtempSync(join(tmpdir(), "mixed-changesets-"));
    if (ignore !== undefined) {
      writeFileSync(join(dir, "config.json"), JSON.stringify({ ignore }));
    }
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, name), text);
    }
    return dir;
  }

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const ignored = ["@theokit/gateway-held"];

  it("names_a_changeset_listing_an_ignored_and_a_versioned_package", () => {
    const changesetDir = fixture(ignored, {
      "mixed.md": '---\n"@theokit/gateway-held": minor\n"@theokit/gateway": patch\n---\n\nBoth.\n',
      "clean.md": '---\n"@theokit/gateway": patch\n---\n\nOne.\n',
    });
    expect(mixedChangesets(changesetDir)).toEqual(["mixed.md"]);
  });

  it("passes_a_changeset_naming_only_ignored_packages", () => {
    const changesetDir = fixture(ignored, {
      "held.md": '---\n"@theokit/gateway-held": minor\n---\n\nHeld back.\n',
    });
    expect(mixedChangesets(changesetDir)).toEqual([]);
  });

  it("passes_a_changeset_naming_only_versioned_packages", () => {
    const changesetDir = fixture(ignored, {
      "core.md": '---\n"@theokit/gateway": patch\n"@theokit/gateway-slack": minor\n---\n\nCore.\n',
    });
    expect(mixedChangesets(changesetDir)).toEqual([]);
  });

  it("passes_an_empty_changeset", () => {
    const changesetDir = fixture(ignored, { "empty.md": "---\n---\n" });
    expect(mixedChangesets(changesetDir)).toEqual([]);
  });

  it("skips_dotfiles_and_a_readme_in_any_case", () => {
    const mixedText = '---\n"@theokit/gateway-held": minor\n"@theokit/gateway": patch\n---\n';
    const changesetDir = fixture(ignored, {
      ".draft.md": mixedText,
      "README.md": mixedText,
      "Readme.md": "# Changesets\n\nNo front matter here.\n",
    });
    expect(mixedChangesets(changesetDir)).toEqual([]);
  });

  it("parses_crlf_and_single_quoted_front_matter", () => {
    const changesetDir = fixture(ignored, {
      "crlf.md": "---\r\n'@theokit/gateway-held': minor\r\n'@theokit/gateway': patch\r\n---\r\n",
    });
    expect(mixedChangesets(changesetDir)).toEqual(["crlf.md"]);
  });

  it("refuses_a_missing_config_naming_the_directory", () => {
    const changesetDir = fixture(undefined, {});
    expect(() => mixedChangesets(changesetDir)).toThrow(`no changesets config in ${changesetDir}`);
  });

  it("refuses_an_ignore_key_that_is_absent_or_not_an_array_naming_the_config", () => {
    const changesetDir = fixture(ignored, {});
    const configPath = join(changesetDir, "config.json");
    for (const config of [{}, { ignore: "@theokit/gateway-held" }, { ignore: [1] }]) {
      writeFileSync(configPath, JSON.stringify(config));
      expect(() => mixedChangesets(changesetDir)).toThrow(
        `${configPath}: "ignore" must be a list of package names`,
      );
    }
  });

  it("refuses_an_ignore_entry_with_a_glob_naming_the_entry", () => {
    for (const entry of ["@theokit/gateway-*", "@theokit/gateway-?", "[a]", "{a,b}", "!a"]) {
      const changesetDir = fixture([entry], {});
      expect(() => mixedChangesets(changesetDir)).toThrow(`ignore entry "${entry}" is a glob`);
      rmSync(changesetDir, { recursive: true, force: true });
    }
  });

  it("refuses_unclosed_front_matter_naming_the_file", () => {
    for (const text of ['---\n"@theokit/gateway": patch\n', 'Title\n---\n"a": patch\n---\n']) {
      const changesetDir = fixture(ignored, { "broken.md": text });
      expect(() => mixedChangesets(changesetDir)).toThrow(
        `${join(changesetDir, "broken.md")}: no front matter between two "---" lines`,
      );
      rmSync(changesetDir, { recursive: true, force: true });
    }
  });

  it("refuses_a_front_matter_line_it_cannot_read", () => {
    const changesetDir = fixture(ignored, {
      "colon.md": "---\n@theokit/gateway-held patch\n---\n",
    });
    const colonFile = join(changesetDir, "colon.md");
    expect(() => mixedChangesets(changesetDir)).toThrow(
      `${colonFile}: malformed front matter line "@theokit/gateway-held patch"`,
    );
    writeFileSync(colonFile, '---\n"@theokit/gateway": pach\n---\n');
    expect(() => mixedChangesets(changesetDir)).toThrow(
      `${colonFile}: unknown bump "pach" in front matter line`,
    );
  });

  it("reads_a_changeset_directory_with_a_subdirectory", () => {
    const changesetDir = fixture(ignored, {
      "core.md": '---\n"@theokit/gateway": patch\n---\n',
    });
    mkdirSync(join(changesetDir, "set-aside.md"));
    expect(mixedChangesets(changesetDir)).toEqual([]);
  });
});
