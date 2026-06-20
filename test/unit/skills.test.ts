import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtractedPrompt } from "../../src/history/types.js";
import {
  agentDiscoveryReportPath,
  buildAgentDiscoveryHandoffPrompt,
  parseAgentDiscoveryReport,
} from "../../src/skills/agent-discovery.js";
import { buildDraftInvocation, detectDraftExecutables } from "../../src/skills/draft.js";
import { filterCoveredCandidates } from "../../src/skills/duplicates.js";
import { buildGenerationHandoffPrompt } from "../../src/skills/generation-template.js";
import { resolveSkillTargets, sanitizeSkillName } from "../../src/skills/paths.js";
import { validateSkillDraft } from "../../src/skills/validate.js";
import type { CommandInvocation, CommandResult, CommandRunner } from "../../src/system/exec.js";
import { nodeFileSystem } from "../../src/system/filesystem.js";

function prompt(id: string, text: string): ExtractedPrompt {
  return { id, source: "codex", sourcePath: "/tmp/history.jsonl", text };
}

describe("skill paths", () => {
  it("sanitizes names and prevents path traversal", () => {
    expect(sanitizeSkillName("../Review PR!!")).toBe("review-pr");
  });

  it("resolves project-local target paths for both ecosystems", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-paths-"));
    const targets = await resolveSkillTargets({
      cwd,
      homeDir: cwd,
      name: "review-pr",
      scope: "project",
      ecosystems: ["claude", "codex"],
    });

    expect(targets.map((target) => path.relative(cwd, target.skillPath))).toEqual([
      path.join(".claude", "skills", "review-pr", "SKILL.md"),
      path.join(".agents", "skills", "review-pr", "SKILL.md"),
    ]);
  });
});

describe("skill duplicate detection", () => {
  it("filters candidates already covered by existing skills", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-dupes-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "ritual-dupes-home-"));
    await mkdir(path.join(cwd, ".claude", "skills", "commit-all-changes-logically"), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, ".claude", "skills", "commit-all-changes-logically", "SKILL.md"),
      [
        "---",
        "name: commit-all-changes-logically",
        "description: Use when asked to commit all current changes in one logical Git commit.",
        "---",
        "",
        "Inspect git status, review unstaged changes, stage intentionally, validate, and commit.",
      ].join("\n"),
    );

    const candidate = {
      id: "candidate-1",
      name: "commit-all-changes-logically",
      summary: "commit all unstaged changes in a single commit",
      prompts: [],
      representativePrompts: [prompt("prompt-1", "commit all unstaged changes in a single commit")],
      count: 3,
      coherence: 1,
      rankScore: 10,
      rankReason: "Repeated commit workflow.",
      isStrong: true,
    };

    const result = await filterCoveredCandidates([candidate], {
      cwd,
      homeDir,
      scope: "project",
      ecosystems: ["claude", "codex"],
      fs: nodeFileSystem,
    });

    expect(result.available).toEqual([]);
    expect(result.covered[0]?.skill.name).toBe("commit-all-changes-logically");
  });
});

describe("skill draft executables", () => {
  it("detects available local generation agents in stable menu order", async () => {
    const runner: CommandRunner = {
      async which(command: string): Promise<string | undefined> {
        return command === "claude" || command === "codex"
          ? `/usr/local/bin/${command}`
          : undefined;
      },
      async run(_invocation: CommandInvocation): Promise<CommandResult> {
        throw new Error("not used");
      },
    };

    await expect(detectDraftExecutables(runner)).resolves.toEqual(["claude", "codex"]);
  });

  it("builds inherited agent launch argv with the prompt as the final argument", () => {
    expect(buildDraftInvocation("claude", "draft this")).toEqual({
      command: "claude",
      args: ["--dangerously-skip-permissions", "draft this"],
    });
    expect(buildDraftInvocation("codex", "draft this")).toEqual({
      command: "codex",
      args: ["--yolo", "draft this"],
    });
  });

  it("builds a handoff prompt that tells the launched agent where to write the skill", () => {
    const prompt = buildGenerationHandoffPrompt(
      {
        skillName: "review-pr",
        scope: "project",
        ecosystems: ["claude", "codex"],
        candidate: {
          id: "candidate-1",
          name: "review-pr",
          summary: "review pull requests",
          prompts: [],
          representativePrompts: [
            {
              id: "prompt-1",
              source: "codex",
              sourcePath: "/history.jsonl",
              text: "review this pull request",
            },
          ],
          count: 3,
          coherence: 1,
          rankScore: 10,
          rankReason: "Repeated review workflow.",
          isStrong: true,
        },
      },
      "/repo/.claude/skills/review-pr/SKILL.md",
    );

    expect(prompt).toContain(
      "Create exactly one reusable agent skill and write it directly to this file:",
    );
    expect(prompt).toContain("/repo/.claude/skills/review-pr/SKILL.md");
    expect(prompt).toContain("Do not print the skill instead of writing the file.");
    expect(prompt).not.toContain("Return only the contents of SKILL.md.");
  });
});

describe("agent discovery", () => {
  it("builds a handoff prompt that asks the agent to write structured findings", () => {
    const prompt = buildAgentDiscoveryHandoffPrompt({
      cwd: "/repo",
      reportPath: "/repo/.ritual/sessions/agent-discovery.json",
      sources: [{ kind: "codex", path: "/home/user/.codex/sessions/session.jsonl" }],
    });

    expect(prompt).toContain("Analyze local recorded Claude and Codex sessions");
    expect(prompt).toContain("[codex] /home/user/.codex/sessions/session.jsonl");
    expect(prompt).toContain("Report path:");
    expect(prompt).toContain("/repo/.ritual/sessions/agent-discovery.json");
    expect(prompt).toContain('"candidates"');
    expect(prompt).toContain("Do not create any SKILL.md files.");
  });

  it("parses agent discovery findings into workflow candidates", () => {
    const result = parseAgentDiscoveryReport(
      JSON.stringify({
        candidates: [
          {
            name: "Review PR Workflow!",
            summary: "Review pull requests for correctness and test coverage.",
            rationale: "Several sessions asked for the same review workflow.",
            confidence: "high",
            scope: "project",
            representativePrompts: [
              "Review this TypeScript PR for correctness bugs and missing tests.",
            ],
            sourcePaths: ["/history.jsonl"],
            repeatCount: 4,
          },
        ],
      }),
      [{ kind: "codex", path: "/history.jsonl" }],
    );

    expect(result.warnings).toEqual([]);
    expect(result.candidates[0]).toMatchObject({
      id: "agent-candidate-1",
      name: "review-pr-workflow",
      count: 4,
      discoverySource: "agent",
      confidence: "high",
      recommendedScope: "project",
    });
    expect(result.candidates[0]?.representativePrompts[0]?.text).toContain("TypeScript PR");
  });

  it("uses a stable Ritual sessions path for discovery reports", () => {
    expect(agentDiscoveryReportPath("/repo", new Date("2026-06-20T01:02:03.004Z"))).toBe(
      path.join("/repo", ".ritual", "sessions", "agent-discovery-2026-06-20T01-02-03-004Z.json"),
    );
  });
});

describe("skill validation", () => {
  it("accepts a valid SKILL.md with built-in validation when agnix is unavailable", async () => {
    const draftDir = await mkdtemp(path.join(os.tmpdir(), "ritual-valid-"));
    await writeFile(
      path.join(draftDir, "SKILL.md"),
      [
        "---",
        "name: review-pr",
        "description: Use when reviewing TypeScript pull requests for correctness and test coverage.",
        "---",
        "",
        "## Workflow",
        "",
        "- Inspect the diff and identify behavior changes.",
        "- Check tests and CI commands before recommending fixes.",
      ].join("\n"),
    );

    const result = await validateSkillDraft({ draftDir, fs: nodeFileSystem });

    expect(result.errors).toEqual([]);
    expect(result.agnixAvailable).toBe(false);
  });

  it("blocks missing frontmatter and placeholder bodies", async () => {
    const draftDir = await mkdtemp(path.join(os.tmpdir(), "ritual-invalid-"));
    await mkdir(draftDir, { recursive: true });
    await writeFile(path.join(draftDir, "SKILL.md"), "TODO");

    const result = await validateSkillDraft({ draftDir, fs: nodeFileSystem });

    expect(result.errors.map((error) => error.code)).toContain("invalid-frontmatter");
  });
});
