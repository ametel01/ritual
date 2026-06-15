import { access } from "node:fs/promises";
import * as path from "node:path";
import type { WorkflowCandidate } from "../prompts/types.js";

export type SkillScope = "project" | "global";
export type SkillEcosystem = "claude" | "codex";

export type SkillTarget = {
  ecosystem: SkillEcosystem;
  scope: SkillScope;
  root: string;
  skillDir: string;
  skillPath: string;
  exists: boolean;
};

export type TargetResolutionOptions = {
  cwd: string;
  homeDir: string;
  name: string;
  scope: SkillScope;
  ecosystems: SkillEcosystem[];
};

const HYPHEN_CASE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function sanitizeSkillName(input: string): string {
  const sanitized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return sanitized.length === 0 ? "repeated-workflow" : sanitized;
}

export function isSafeSkillName(input: string): boolean {
  return HYPHEN_CASE_PATTERN.test(input) && !input.includes("..") && !path.isAbsolute(input);
}

export function recommendScope(candidate: WorkflowCandidate, cwd: string): SkillScope {
  const text = [
    candidate.name,
    candidate.summary,
    ...candidate.prompts.map((prompt) => prompt.text),
  ]
    .join(" ")
    .toLowerCase();
  const projectName = path.basename(cwd).toLowerCase();
  const projectHints = [
    projectName,
    "package.json",
    "tsconfig",
    "makefile",
    "ci",
    "github actions",
    "src/",
    "test/",
    "repo",
    "repository",
    "bun run",
    "bun",
    "pytest",
    "vitest",
  ];
  return projectHints.some((hint) => text.includes(hint)) ? "project" : "global";
}

export async function resolveSkillTargets(
  options: TargetResolutionOptions,
): Promise<SkillTarget[]> {
  const name = sanitizeSkillName(options.name);
  if (!isSafeSkillName(name)) {
    throw new Error(`Unsafe skill name: ${options.name}`);
  }

  const targets = await Promise.all(
    options.ecosystems.map(async (ecosystem) => {
      const root = skillRoot({
        cwd: options.cwd,
        homeDir: options.homeDir,
        ecosystem,
        scope: options.scope,
      });
      const skillDir = path.resolve(root, name);
      const skillPath = path.join(skillDir, "SKILL.md");
      const relative = path.relative(path.resolve(root), skillDir);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Resolved skill target escapes root: ${skillDir}`);
      }
      return {
        ecosystem,
        scope: options.scope,
        root,
        skillDir,
        skillPath,
        exists: await exists(skillPath),
      };
    }),
  );

  return targets;
}

export function skillRoot(options: {
  cwd: string;
  homeDir: string;
  ecosystem: SkillEcosystem;
  scope: SkillScope;
}): string {
  if (options.scope === "project") {
    return path.join(options.cwd, options.ecosystem === "claude" ? ".claude" : ".agents", "skills");
  }

  if (options.ecosystem === "claude") {
    return path.join(options.homeDir, ".claude", "skills");
  }
  return path.join(globalAgentsRoot(options.homeDir), "skills");
}

function globalAgentsRoot(homeDir: string): string {
  const env = process.env as NodeJS.ProcessEnv & {
    APPDATA?: string;
    XDG_CONFIG_HOME?: string;
  };
  if (process.platform === "win32") {
    return path.join(env.APPDATA ?? path.join(homeDir, "AppData", "Roaming"), "agents");
  }
  if (process.platform === "darwin") {
    return path.join(homeDir, ".agents");
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(homeDir, ".config"), "agents");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
