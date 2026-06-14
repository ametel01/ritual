import type { ExtractedPrompt } from "../../src/history/types.js";
import { rankWorkflowCandidates } from "../../src/prompts/rank.js";

function prompt(id: string, text: string): ExtractedPrompt {
  return { id, source: "codex", sourcePath: "/tmp/history.jsonl", text };
}

describe("prompt ranking", () => {
  it("groups repeated workflow prompts while preserving original text", () => {
    const prompts = [
      prompt("1", "Review this TypeScript PR for correctness bugs and missing Vitest tests."),
      prompt("2", "Please review this TypeScript pull request for bugs and missing tests."),
      prompt("3", "Review this TypeScript PR for CI risks, bugs, and missing coverage."),
      prompt("4", "What is the capital of France?"),
    ];

    const candidates = rankWorkflowCandidates(prompts);

    expect(candidates[0]?.isStrong).toBe(true);
    expect(candidates[0]?.count).toBe(3);
    expect(candidates[0]?.representativePrompts[0]?.text).toBe(prompts[0]?.text);
    expect(candidates[0]?.rankReason).toContain("strong recurrence");
  });

  it("exposes two-prompt near misses without marking them strong", () => {
    const prompts = [
      prompt("1", "Draft release notes from the changelog and version tag."),
      prompt("2", "Please draft release notes from the changelog for the release tag."),
    ];

    const candidates = rankWorkflowCandidates(prompts);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.isStrong).toBe(false);
  });
});
