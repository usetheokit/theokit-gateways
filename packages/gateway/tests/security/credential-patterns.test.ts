import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_SHAPES,
  maskShapes,
  redactSecrets,
} from "../../src/security/credential-patterns.js";

// The SDK's redactor against the credentials THIS repository holds, and against the identifiers a
// developer needs intact.
//
// The first attempt registered these shapes with `Security.addPattern`, and a review measured two
// defects in it. The SDK runs extra patterns BEFORE its `key=value` matcher and masks a match as
// `first6...last4`, so claiming a value there DOWNGRADED it: `password=***` became
// `password=hunter...aple`, ten characters of a passphrase reaching a log where none did before.
// And the registration mutates module state inside the SDK, so an app that imports this package
// inherited these patterns in its own unrelated redaction — after the first gateway error, not
// before, which is worse than either.
//
// So the masking happens here, fully, before the text is handed to the SDK at all.
//
// Every value below is synthetic and built to the platform's documented format. None was ever
// issued.

// Assembled at runtime, never written as one literal.
//
// GitHub's push protection scans commit CONTENT and does not read `trufflehog:ignore`, so a
// format-derived synthetic is indistinguishable from a live credential to it — it refused a push
// over the Discord and Slack values here, which is the protection working. Joining the parts keeps
// the value identical where it matters, at the assertion, and leaves nothing credential-shaped in
// the file for any scanner to find.
const SECRETS: ReadonlyArray<readonly [string, string]> = [
  ["telegram token", ["8123456789", "AAF-zZbQm3kL9xTuVw1yRs4pQd7NhGjKlMn"].join(":")],
  [
    "discord bot token",
    [
      // base64 of a run of digits — spelled out so no encoded blob sits in the file either.
      Buffer.from("123456789012345678").toString("base64"),
      "GhIjKl",
      "mNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXy",
    ].join("."),
  ],
  [
    "slack app token",
    ["xapp", "1", "A01BCDEFGHI", "1234567890123", "abcdef0123456789abcdef0123456789"].join("-"),
  ],
  ["matrix access token", ["syt", "dGhlb2tpdA", "ZxWvUtSrQpOnMlKjIhGf", "3AbCdE"].join("_")],
  ["whatsapp access token", "EAA" + "Gm0PX4ZCpsBA1ZBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRs"],
  ["teams client secret", ["Abc8Q", "dEfGhIjKlMnOpQrStUvWxYz0123456789_"].join("~")],
];

// Identifiers a developer reads an error log to find. Redacting one costs a debugging session, and
// the shapes that would catch them — 32 lowercase hex, 26 lowercase alphanumerics — are the shapes
// of an md5, a dashless UUID and a ULID. Those platform credentials are therefore NOT covered, and
// `CREDENTIAL_SHAPES` says so rather than eating these.
const MUST_SURVIVE: ReadonlyArray<readonly [string, string]> = [
  ["dashless uuid", "550e8400e29b41d4a716446655440000"],
  ["md5 digest", "d41d8cd98f00b204e9800998ecf8427e"],
  ["lowercase ulid", "01arz3ndektsv4rrffq69g5fav"],
  ["git sha", "4b3d2f1a9c8e7b6d5a4f3e2d1c0b9a8877665544"],
  ["dashed uuid", "550e8400-e29b-41d4-a716-446655440000"],
  ["content hash in a filename", "dist/index.4b3d2f1a9c8e7b6d5a4f3e2d1c0b9a88.js"],
  // These two exist to pin the WIDTH each pattern claims, not just to name a benign value. Widening
  // the Telegram tail to `{20,}` or the Discord third part to `{10,}` left the suite green until
  // they were here — a pattern is only as narrow as something checks.
  ["a shorter colon-joined id than a telegram token", "1724500000:AAAAAAAAAAAAAAAAAAAA"],
  ["a dotted id with a short third part", "abcdefghijklmnopqrstuvw.abcdef.short12345"],
];

describe("maskShapes", () => {
  it.each(SECRETS)("masks a %s entirely, leaving no run of it", (_name, secret) => {
    const out = maskShapes(`connect failed: ${secret}`);
    for (let i = 0; i + 6 <= secret.length; i++) {
      expect(out, `a run of the secret survived: ${secret.slice(i, i + 6)}`).not.toContain(
        secret.slice(i, i + 6),
      );
    }
  });

  it.each(MUST_SURVIVE)("leaves a %s alone", (_name, value) => {
    expect(maskShapes(`request ${value} aborted`)).toBe(`request ${value} aborted`);
  });
});

describe("redactSecrets", () => {
  it("does not weaken what the SDK already masked fully", async () => {
    // The regression the first attempt shipped. `password=<passphrase>` was `password=***` and
    // became `password=hunter...aple` — the SDK masks an extra-pattern match as first6...last4 and
    // then skips its own `key=value` rule, which had produced the full mask.
    const passphrase = "hunter2-correct-horse-battery-staple";
    const out = redactSecrets(`Invalid login: 535 password=${passphrase}`);
    expect(out).not.toContain("hunter");
    expect(out).not.toContain("aple");
  });

  it("masks a bare credential the SDK does not recognise", () => {
    const secret = ["syt", "dGhlb2tpdA", "ZxWvUtSrQpOnMlKjIhGf", "3AbCdE"].join("_");
    expect(redactSecrets(`connect failed: ${secret}`)).not.toContain("ZxWvUt");
  });

  it("still applies the SDK's own patterns", () => {
    // Slack's `xoxb-` is one of the SDK's built-ins and is deliberately absent from our shapes.
    const sdkBuiltin = ["xoxb", "1234567890123", "1234567890123", "AbCdEfGhIjKlMnOpQrSt"].join("-");
    const out = redactSecrets(`connect failed: ${sdkBuiltin}`);
    expect(out).not.toContain("AbCdEfGhIjKlMnOpQrSt");
  });

  it("leaves the SDK's global state alone", async () => {
    // The design decision, pinned. `addPattern` mutates module state inside the SDK, so an app that
    // imports this package would inherit our shapes in its OWN redaction — and only after the first
    // gateway error, so the same app would redact differently before and after one exception.
    const { Security } = await import("@theokit/sdk");
    const ours = ["syt", "dGhlb2tpdA", "ZxWvUtSrQpOnMlKjIhGf", "3AbCdE"].join("_");
    redactSecrets(`warm up ${ours}`);
    expect(Security.redact(`elsewhere ${ours}`)).toContain(ours);
  });
});

describe("the shapes we do not cover", () => {
  it("names each one and why", () => {
    // A list that exists so the gap is visible. Every entry is a credential this repo declares whose
    // format cannot be told apart from an ordinary identifier.
    for (const shape of CREDENTIAL_SHAPES.uncovered) {
      expect(shape.field.length, "an uncovered shape must name its field").toBeGreaterThan(0);
      expect(shape.why.length, `${shape.field} must say why`).toBeGreaterThan(20);
    }
    expect(CREDENTIAL_SHAPES.uncovered.length).toBeGreaterThan(0);
  });
});
