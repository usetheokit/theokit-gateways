/**
 * `errorKind` names a caught failure in a refusal or key-set message by its class and code only:
 * the error's own text belongs to the SDK, the loader or the network, and may carry anything.
 */

import { describe, expect, it } from "vitest";

import { errorKind } from "../src/error-kind.js";

describe("errorKind", () => {
  it("names an error by its class", () => {
    expect(errorKind(new TypeError("token eyJhbGciOi leaked here"))).toBe("TypeError");
  });

  it("adds an identifier-shaped code", () => {
    const error = Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });

    expect(errorKind(error)).toBe("Error ECONNREFUSED");
  });

  it("leaves out a code that is not identifier-shaped", () => {
    const error = Object.assign(new Error("x"), { code: "a code with spaces" });

    expect(errorKind(error)).toBe("Error");
  });

  it("calls a class name that is not identifier-shaped an unnamed error", () => {
    expect(errorKind({ name: "Bearer eyJ.payload.sig" })).toBe("an unnamed error");
    expect(errorKind({ name: "x".repeat(65) })).toBe("an unnamed error");
  });

  it("accepts a class name of 64 characters", () => {
    expect(errorKind({ name: `A${"b".repeat(63)}` })).toBe(`A${"b".repeat(63)}`);
  });

  it("names a thrown primitive by its type", () => {
    expect(errorKind("a secret string")).toBe("a thrown string");
    expect(errorKind(undefined)).toBe("a thrown undefined");
    expect(errorKind(null)).toBe("a thrown object");
  });
});
