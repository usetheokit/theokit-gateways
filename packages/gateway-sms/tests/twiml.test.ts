import { describe, expect, it } from "vitest";

import { twiml } from "../src/twiml.js";

describe("twiml", () => {
  it("escapes text", () => {
    expect(twiml.response(twiml.say('a < b & "c"'))).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>a &lt; b &amp; &quot;c&quot;</Say></Response>',
    );
  });
  it("escapes attributes and builds gather", () => {
    expect(
      twiml.gather({ action: '/a?x=1&y="2"', input: "speech", timeoutSeconds: 5, prompt: "hi <" }),
    ).toBe(
      '<Gather action="/a?x=1&amp;y=&quot;2&quot;" input="speech" timeout="5"><Say>hi &lt;</Say></Gather>',
    );
    expect(twiml.gather({ action: "/a" })).toBe('<Gather action="/a"/>');
  });
  it("builds say options, redirect, hangup, empty response", () => {
    expect(twiml.say("x", { voice: "alice", language: "en-US" })).toBe(
      '<Say voice="alice" language="en-US">x</Say>',
    );
    expect(twiml.redirect("/r?a=1&b=2")).toBe("<Redirect>/r?a=1&amp;b=2</Redirect>");
    expect(twiml.hangup()).toBe("<Hangup/>");
    expect(twiml.response()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });
  it("strips XML-illegal control characters", () => {
    expect(twiml.say("a\u0000b")).toBe("<Say>ab</Say>");
  });
});
