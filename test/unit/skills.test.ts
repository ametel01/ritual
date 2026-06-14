import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { resolveSkillTargets, sanitizeSkillName } from "../../src/skills/paths.js";
import { validateSkillDraft } from "../../src/skills/validate.js";
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
