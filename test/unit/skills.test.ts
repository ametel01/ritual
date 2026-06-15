import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { buildDraftInvocation, detectDraftExecutables } from "../../src/skills/draft.js";
import { buildGenerationHandoffPrompt } from "../../src/skills/generation-template.js";
import { resolveSkillTargets, sanitizeSkillName } from "../../src/skills/paths.js";
import { validateSkillDraft } from "../../src/skills/validate.js";
import type { CommandInvocation, CommandResult, CommandRunner } from "../../src/system/exec.js";
import { nodeFileSystem } from "../../src/system/filesystem.js";

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

  it("builds a handoff prompt that tells the launched agent where to write the draft", () => {
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
      "/repo/.ritual/drafts/review-pr/SKILL.md",
    );

    expect(prompt).toContain("Create exactly one reusable agent skill and write it to this file:");
    expect(prompt).toContain("/repo/.ritual/drafts/review-pr/SKILL.md");
    expect(prompt).toContain("Do not print the skill instead of writing the file.");
    expect(prompt).not.toContain("Return only the contents of SKILL.md.");
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
