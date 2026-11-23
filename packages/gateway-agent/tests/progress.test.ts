import type { AgentOutputEvent } from "@theokit/presenter";
import { describe, expect, it } from "vitest";
import { progressFor } from "../src/index.js";

const toolCall: AgentOutputEvent = { type: "tool-call", callId: "1", name: "search", input: {} };
const reasoning: AgentOutputEvent = { type: "reasoning", text: "thinking" };

describe("progressFor", () => {
  it("shows no tool-call line when the adapter cannot edit", () => {
    expect(progressFor({ edit: false })(toolCall)).toBeUndefined();
  });

  it("shows a tool-call line when the adapter can edit", () => {
    expect(progressFor({ edit: true })(toolCall)).toContain("search");
  });

  it("lets an override win over the derived tier, both ways", () => {
    expect(progressFor({ edit: false }, { "tool-call": true })(toolCall)).toContain("search");
    expect(progressFor({ edit: true }, { "tool-call": false })(toolCall)).toBeUndefined();
  });

  it("keeps reasoning and text off unless overridden", () => {
    expect(progressFor({ edit: true })(reasoning)).toBeUndefined();
    expect(progressFor({ edit: true }, { reasoning: true })(reasoning)).toBe("thinking");
    expect(progressFor({ edit: true })({ type: "text", text: "hi" })).toBeUndefined();
  });
});
