// Every way a document can carry the three facts and still not tell the integration story.
//
// Written after a review broke the first version of this gate: with the facts looked up across the
// whole file, BOTH sections could be deleted and replaced with sentences DENYING the relationship
// ("We do not use handleChannelWebhook and we do not depend on theokit-sdk") and the gate still
// reported `PASS — 2 document(s) name the seam`. Two of the three root-README facts were satisfied
// by the H1 title and a provenance line that predate the section entirely.
//
// The fix is scope: a fact counts when it appears inside the section that is supposed to tell the
// story, in visible prose. Every case below is an attack that passed before.

import { describe, expect, it } from "vitest";

import { missingFacts, sectionBody } from "../lib/integration-story.mjs";

const HEADING = "How this fits with TheoKit";
const FACTS = ["handleChannelWebhook", "theokit-sdk"];

/** A document whose section tells the story, with the usual surroundings. */
function doc(body) {
  return `# theokit-gateways\n\nA provenance line naming theokit-sdk.\n\n## ${HEADING}\n\n${body}\n\n## Install\n\nUnrelated, and it mentions handleChannelWebhook.\n`;
}

describe("sectionBody", () => {
  it("returns only the named section, stopping at the next heading", () => {
    const body = sectionBody(doc("The seam is handleChannelWebhook."), HEADING);
    expect(body).toContain("The seam is handleChannelWebhook.");
    expect(body).not.toContain("Unrelated");
  });

  it("is undefined when the section is absent — the deletion the review exploited", () => {
    expect(sectionBody("# Title\n\n## Install\n\nhandleChannelWebhook\n", HEADING)).toBeUndefined();
  });
});

describe("missingFacts", () => {
  const check = (text) => missingFacts(text, { file: "README.md", heading: HEADING, facts: FACTS });

  it("accepts a section that names every fact", () => {
    expect(check(doc("handleChannelWebhook hands over the payload; theokit-sdk redacts."))).toEqual(
      [],
    );
  });

  it("rejects a deleted section even when the facts survive elsewhere", () => {
    const text = "# theokit-gateways\n\nhandleChannelWebhook and theokit-sdk, in passing.\n";
    expect(check(text)).toEqual(["README.md: has no `## How this fits with TheoKit` section"]);
  });

  it("does not count a fact hidden in an HTML comment", () => {
    const faults = check(
      doc("<!-- TODO: document handleChannelWebhook one day -->\ntheokit-sdk redacts."),
    );
    expect(faults).toEqual([
      "README.md: `## How this fits with TheoKit` never names handleChannelWebhook",
    ]);
  });

  it("does not count a fact that appears only as a link target", () => {
    const faults = check(
      doc("See [the docs](https://example.com/api#handleChannelWebhook). theokit-sdk redacts."),
    );
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain("handleChannelWebhook");
  });

  it("counts a link LABEL — that is the fact being named, not hidden", () => {
    expect(
      check(doc("handleChannelWebhook hands over; [theokit-sdk](https://x.test) redacts.")),
    ).toEqual([]);
  });

  it("does not count a fact glued inside a longer word", () => {
    const faults = check(doc("We never use xhandleChannelWebhookx here. theokit-sdk redacts."));
    expect(faults).toHaveLength(1);
  });

  it("does not count a hyphen-extended near-miss as the repository name", () => {
    const faults = check(doc("handleChannelWebhook hands over; theokit-sdk-experimental redacts."));
    expect(faults).toEqual(["README.md: `## How this fits with TheoKit` never names theokit-sdk"]);
  });

  it("reports a missing file as its own fault, not as missing facts", () => {
    expect(missingFacts(undefined, { file: "README.md", heading: HEADING, facts: FACTS })).toEqual([
      "README.md: not found",
    ]);
  });
});

// A second review found the fix incomplete: `sectionBody` ran BEFORE anything was stripped, so a
// heading written inside an HTML comment or a fenced code block defined a phantom section — and the
// real one could then be deleted. The bypass the previous commit claimed to have closed was still
// reachable, through the heading instead of the body. These are those attacks.
describe("hiding places that defined a phantom section", () => {
  const check = (text) => missingFacts(text, { file: "README.md", heading: HEADING, facts: FACTS });
  const phantom = (open, close) =>
    `# t\n\n${open}\n## ${HEADING}\n\nhandleChannelWebhook and theokit-sdk.\n${close}\n\n## Install\n\nUnrelated.\n`;

  it("does not accept a heading written inside an HTML comment", () => {
    expect(check(phantom("<!--", "-->"))).toEqual([
      "README.md: has no `## How this fits with TheoKit` section",
    ]);
  });

  it("does not accept a heading written inside a fenced code block", () => {
    expect(check(phantom("```md", "```"))).toEqual([
      "README.md: has no `## How this fits with TheoKit` section",
    ]);
  });

  it("does not count a fact that appears only in a reference-link definition", () => {
    const text = doc(
      "See [the docs][d]. theokit-sdk redacts.\n\n[d]: https://x.test/#handleChannelWebhook",
    );
    expect(check(text)).toHaveLength(1);
  });

  it("does not count a fact that appears only inside a bare autolink", () => {
    const text = doc("theokit-sdk redacts. See <https://x.test/api/handleChannelWebhook>.");
    expect(check(text)).toHaveLength(1);
  });
});

// A third review found four more ways to write a phantom heading the reader never sees. Three are
// fences the strip did not recognise (`~~~`, indented 1-3 spaces, never closed) and one is an HTML
// comment that is never closed — CommonMark runs both to end of file, so everything after them is
// invisible while the gate still read the heading.
describe("hiding places a reader never sees", () => {
  const check = (text) => missingFacts(text, { file: "README.md", heading: HEADING, facts: FACTS });
  const gone = ["README.md: has no `## How this fits with TheoKit` section"];
  const phantom = (open, close) =>
    `# t\n\n${open}\n## ${HEADING}\n\nhandleChannelWebhook and theokit-sdk.\n${close}\n\n## Install\n\nUnrelated.\n`;

  it("does not accept a heading inside a tilde fence", () => {
    expect(check(phantom("~~~md", "~~~"))).toEqual(gone);
  });

  it("does not accept a heading inside a fence indented up to three spaces", () => {
    expect(check(phantom("   ```md", "   ```"))).toEqual(gone);
  });

  it("does not accept a heading after a fence that is never closed", () => {
    expect(
      check(`# t\n\n\`\`\`md\n## ${HEADING}\n\nhandleChannelWebhook and theokit-sdk.\n`),
    ).toEqual(gone);
  });

  it("does not accept a heading after an HTML comment that is never closed", () => {
    expect(check(`# t\n\n<!--\n## ${HEADING}\n\nhandleChannelWebhook and theokit-sdk.\n`)).toEqual(
      gone,
    );
  });

  it("still accepts a four-space indented block as ordinary content, not a fence", () => {
    // Four spaces is an indented code block in CommonMark, not a fence — it must not swallow the
    // rest of the document. Guards the strip against becoming a false-FAIL machine.
    expect(check(doc("    an indented example\n\nhandleChannelWebhook and theokit-sdk."))).toEqual(
      [],
    );
  });
});
