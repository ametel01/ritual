import type { ExtractedPrompt } from "../../src/history/types.js";
import { rankWorkflowCandidates, rankWorkflowCandidatesAsync } from "../../src/prompts/rank.js";

function prompt(id: string, text: string, createdAt?: string): ExtractedPrompt {
  return {
    id,
    source: "codex",
    sourcePath: "/tmp/history.jsonl",
    text,
    ...(createdAt === undefined ? {} : { createdAt }),
  };
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
    expect(candidates[0]?.rankReason).toContain("good skill candidate");
  });

  it("shows the most recent matching prompts as representatives", () => {
    const prompts = [
      prompt(
        "1",
        "Review this TypeScript PR for correctness bugs and missing Vitest tests.",
        "2026-06-01T00:00:00.000Z",
      ),
      prompt(
        "2",
        "Please review this TypeScript pull request for bugs and missing tests.",
        "2026-06-03T00:00:00.000Z",
      ),
      prompt(
        "3",
        "Review this TypeScript PR for CI risks, bugs, and missing coverage.",
        "2026-06-02T00:00:00.000Z",
      ),
    ];

    const candidates = rankWorkflowCandidates(prompts);

    expect(candidates[0]?.representativePrompts.map((representative) => representative.id)).toEqual(
      ["2", "3", "1"],
    );
    expect(candidates[0]?.summary).toBe(prompts[1]?.text);
  });

  it("supports async ranking for interactive progress rendering", async () => {
    const prompts = [
      prompt("1", "Review this TypeScript PR for correctness bugs and missing Vitest tests."),
      prompt("2", "Please review this TypeScript pull request for bugs and missing tests."),
      prompt("3", "Review this TypeScript PR for CI risks, bugs, and missing coverage."),
    ];

    const candidates = await rankWorkflowCandidatesAsync(prompts);

    expect(candidates[0]?.isStrong).toBe(true);
    expect(candidates[0]?.count).toBe(3);
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

  it("does not build candidate names from attachment and path noise", () => {
    const prompts = [
      prompt("1", "image source png usersalexmetellisourcescopepilotmarketingchatgpt"),
      prompt("2", "image source png usersalexmetellisourcescopepilotmarketingchatgpt"),
      prompt("3", "image source png usersalexmetellisourcescopepilotmarketingchatgpt"),
    ];

    const candidates = rankWorkflowCandidates(prompts);

    expect(candidates[0]?.name).toBe("repeated-workflow");
  });
});
