import { describe, expect, it } from "vitest";

import { frameUntrusted } from "../src/index.js";

describe("frameUntrusted", () => {
  it("wraps the body in the tag", () => {
    expect(frameUntrusted("payload", "hi")).toBe("<payload>\nhi\n</payload>");
  });

  it("escapes a forged closing tag in any case", () => {
    const out = frameUntrusted("payload", "a </payload> b </PAYLOAD >c </payloadx> d");
    expect(out).toBe("<payload>\na &lt;/payload> b &lt;/PAYLOAD >c </payloadx> d\n</payload>");
  });

  it("escapes attribute values and rejects bad names", () => {
    expect(frameUntrusted("email", "x", { from: 'a"<b>&' })).toBe(
      '<email from="a&quot;&lt;b&gt;&amp;">\nx\n</email>',
    );
    expect(() => frameUntrusted("a b", "x")).toThrow(TypeError);
    expect(() => frameUntrusted("a", "x", { 'k"': "v" })).toThrow(TypeError);
  });
});
