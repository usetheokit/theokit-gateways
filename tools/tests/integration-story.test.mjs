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

// A third review found ways to write a phantom heading the reader never sees: fences the strip did
// not recognise — `~~~`, and fences indented one to three spaces. Two more cases in this block, the
// unterminated fence and the unterminated comment, were closed in that round and deliberately
// reopened in the next one; the comment above them says why.
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

  // These two asserted the OPPOSITE one round ago, and the assertion was withdrawn on evidence
  // rather than deleted. Running an unterminated fence or comment to end of file is what CommonMark
  // says, and implementing it failed four innocent documents — `<!--` written in prose was enough.
  // The cost fell on authors who did nothing wrong; the benefit was against an author deliberately
  // gaming a gate that already states it cannot check whether the section is true.
  it("accepts a document whose heading follows a fence that is never closed", () => {
    expect(
      check(`# t\n\n\`\`\`md\n## ${HEADING}\n\nhandleChannelWebhook and theokit-sdk.\n`),
    ).toEqual([]);
  });

  it("accepts a document whose heading follows a comment that is never closed", () => {
    expect(check(`# t\n\n<!--\n## ${HEADING}\n\nhandleChannelWebhook and theokit-sdk.\n`)).toEqual(
      [],
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

// A fourth review found a ninth bypass and, worse, four FALSE FAILS: an innocent document
// containing `<!--` in prose, or a four-backtick fence, failed the gate outright. That is the more
// expensive defect — a bypass needs someone to try, a false fail happens to someone who did nothing
// wrong, and it is what teaches a team to distrust the next report.
//
// So the rule changed direction: a block that never closes is NOT treated as hiding anything. An
// unterminated fence does run to end of file in CommonMark, but the reader who writes one is
// making a typo, while the author who exploits one is gaming a gate that already admits it cannot
// check accuracy.
// The `<script>` and `<style>` assertions that stood here were withdrawn with the rule they tested.
// They defended against an author deliberately hiding a heading — which `visibleText`'s docblock now
// declares out of scope — while costing three untested branches and a false fail on a document that
// showed two script tags. Keeping an adversarial defence after declaring adversaries out of scope is
// the incoherence, not the removal.
describe("blocks that hide a heading", () => {
  const check = (text) => missingFacts(text, { file: "README.md", heading: HEADING, facts: FACTS });
  const gone = ["README.md: has no `## How this fits with TheoKit` section"];
  const phantom = (open, close) =>
    `# t\n\n${open}\n## ${HEADING}\n\nhandleChannelWebhook and theokit-sdk.\n${close}\n\n## Install\n\nUnrelated.\n`;

  // Withdrawn on evidence, like the two above. Recognising YAML front matter meant treating `---`
  // on line 0 as an opener, and nothing distinguishes that from a thematic break — an ordinary
  // README starting with a horizontal rule had everything up to its next `---` blanked. Hiding a
  // heading in front matter is adversarial; starting a document with a rule is not.
  it("accepts a thematic break as the first line, front matter or not", () => {
    expect(
      check(
        `---\n\n# t\n\n## ${HEADING}\n\nhandleChannelWebhook, theokit-sdk, theokit-gateways.\n\n---\n`,
      ),
    ).toEqual([]);
  });

  it("does not let a short line close a longer fence", () => {
    // ````md … ``` … ```` — CommonMark requires the closer to be at least as long as the opener, so
    // the inner line is content and the heading after it is still inside the block.
    const text = `# t\n\n\`\`\`\`md\n\`\`\`\n## ${HEADING}\n\nhandleChannelWebhook and theokit-sdk.\n\`\`\`\`\n\n## Install\n`;
    expect(check(text)).toEqual(gone);
  });
});

describe("innocent documents the gate must not fail", () => {
  const check = (text) => missingFacts(text, { file: "README.md", heading: HEADING, facts: FACTS });

  it("accepts prose that mentions the comment marker", () => {
    expect(
      check(
        doc("A note is written with `<!--` and its mirror. handleChannelWebhook, theokit-sdk."),
      ),
    ).toEqual([]);
  });

  it("accepts a four-backtick fence closed with four backticks", () => {
    expect(check(doc("handleChannelWebhook, theokit-sdk.\n\n````ts\nconst a = 1;\n````"))).toEqual(
      [],
    );
  });

  it("accepts a three-backtick fence closed with four", () => {
    expect(check(doc("handleChannelWebhook, theokit-sdk.\n\n```ts\nconst a = 1;\n````"))).toEqual(
      [],
    );
  });

  it("accepts a fence whose closer is indented", () => {
    // Guards the closer's own indentation allowance, which survived a mutation until it had a test.
    expect(check(doc("handleChannelWebhook, theokit-sdk.\n\n```ts\nconst a = 1;\n   ```"))).toEqual(
      [],
    );
  });
});

// Round five. The gate had grown to 192 lines of hand-written CommonMark defending 63 lines of
// documentation, and each review found another bypass and another FALSE FAIL. The bypasses were all
// adversarial — nobody hides a heading in a `<textarea>` by accident — while the false fails hit
// authors who did nothing wrong. So the threat model is now stated and the parser shrank to it:
// this gate defends against the section being deleted or commented out, not against an author
// deliberately hiding a heading from it. Someone willing to do that can equally write a section
// naming every fact that says something false, which this gate has never checked.
describe("the accidental threat model, and its stated limits", () => {
  const check = (text) => missingFacts(text, { file: "README.md", heading: HEADING, facts: FACTS });
  const gone = ["README.md: has no `## How this fits with TheoKit` section"];

  it("catches the section commented out during a rewrite", () => {
    const text = `# t\n\n<!--\n## ${HEADING}\n\nhandleChannelWebhook, theokit-sdk, theokit-gateways.\n-->\n\n## Install\n`;
    expect(check(text)).toEqual(gone);
  });

  it("accepts prose about comment markers, closing marker and all", () => {
    // The false fail that came back once already: a document explaining how to comment something
    // out names both markers, and an earlier version blanked everything between them.
    const text = doc(
      "Wrap it in `<!--` and close with `-->`. handleChannelWebhook, theokit-sdk, theokit-gateways.",
    );
    expect(check(text)).toEqual([]);
  });

  it("accepts a table whose cells name both comment markers", () => {
    const text = doc(
      "| a | b |\n|---|---|\n| `<!--` | opens |\n| `-->` | closes |\n\nhandleChannelWebhook, theokit-sdk, theokit-gateways.",
    );
    expect(check(text)).toEqual([]);
  });

  it("treats a real comment reopened on a line that closes an earlier one as open", () => {
    const text = `# t\n\n<!-- note --> <!--\n## ${HEADING}\n\nhandleChannelWebhook, theokit-sdk.\n-->\n\n## Install\n`;
    expect(check(text)).toEqual(gone);
  });

  it("accepts a document that opens a script tag twice in examples", () => {
    const text = doc(
      '`<script src="a.js"></script>` and `<script src="b.js"></script>`. handleChannelWebhook, theokit-sdk, theokit-gateways.',
    );
    expect(check(text)).toEqual([]);
  });

  it("accepts a thematic break on the first line", () => {
    const text = `---\n\n# t\n\n## ${HEADING}\n\nhandleChannelWebhook, theokit-sdk, theokit-gateways.\n\n---\n\n## Install\n`;
    expect(check(text)).toEqual([]);
  });

  it("blanks the fence's own opening and closing lines, not only what is between", () => {
    // Both were untested; a mutant that shifted either bound survived the previous review.
    const text = `# t\n\n\`\`\`md ## ${HEADING}\nx\n\`\`\` handleChannelWebhook\n\n## Install\n`;
    expect(check(text)).toEqual(gone);
  });

  it("hides a heading inside a fence whose closer carries trailing whitespace", () => {
    // The discriminating case: with the closer unrecognised the fence never closes, is discarded,
    // and the heading inside it becomes visible — a bypass. Asserting the fence closes is not
    // enough to catch that, which is why the mutation on `\\s*$` survived until this test.
    const text = `# t\n\n\`\`\`md\n## ${HEADING}\n\nhandleChannelWebhook, theokit-sdk.\n\`\`\`   \n\n## Install\n`;
    expect(check(text)).toEqual(gone);
  });

  it("blanks the fence's own opening line, so a fact written on it does not count", () => {
    // A heading can never sit on a boundary line — those start with the marker — so the bounds are
    // observable only through facts, and only on the OPENING line: a valid closing fence carries
    // the marker and whitespace and nothing else, so no fact can sit on it. Mutating `<= index` to
    // `< index` therefore survives, and it survives because it changes nothing observable — an
    // equivalent mutant, recorded here so the next review does not re-file it as a coverage gap.
    const text = doc(
      "handleChannelWebhook and theokit-gateways.\n\n```ts theokit-sdk\nconst a = 1;\n```",
    );
    expect(check(text)).toEqual([
      "README.md: `## How this fits with TheoKit` never names theokit-sdk",
    ]);
  });

  it("closes a fence whose marker is followed by trailing whitespace", () => {
    const text = doc(
      "handleChannelWebhook, theokit-sdk, theokit-gateways.\n\n```ts\nconst a = 1;\n```   ",
    );
    expect(check(text)).toEqual([]);
  });
});
