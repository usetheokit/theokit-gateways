import { describe, expect, it } from "vitest";

import { parseFlatXml } from "../src/index.js";

describe("parseFlatXml", () => {
  it("reads CDATA and plain tags, decodes entities, skips the xml root", () => {
    const xml =
      "<xml><A><![CDATA[a & b]]></A><B>x &lt;y&gt; &amp; &quot;z&quot; &#39;w&#39;</B></xml>";
    expect(parseFlatXml(xml)).toEqual({ A: "a & b", B: `x <y> & "z" 'w'` });
  });

  it("answers an empty record for text with no tags", () => {
    expect(parseFlatXml("nothing")).toEqual({});
  });
});
