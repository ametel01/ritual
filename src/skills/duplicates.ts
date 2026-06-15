import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { normalizePrompt } from "../prompts/normalize.js";
import type { WorkflowCandidate } from "../prompts/types.js";
import type { FileSystem } from "../system/filesystem.js";
import type { SkillEcosystem, SkillScope } from "./paths.js";
import { skillRoot } from "./paths.js";

export type ExistingSkill = {
  readonly name: string;
  readonly skillPath: string;
  readonly text: string;
};

export type DuplicateSkillMatch = {
  readonly candidate: WorkflowCandidate;
  readonly skill: ExistingSkill;
  readonly score: number;
};

export type DuplicateSkillScanOptions = {
  readonly cwd: string;
  readonly homeDir: string;
  readonly scope: SkillScope;
  readonly ecosystems: SkillEcosystem[];
  readonly fs: FileSystem;
};

const DUPLICATE_THRESHOLD = 0.42;

export async function discoverExistingSkills(
  options: DuplicateSkillScanOptions,
): Promise<ExistingSkill[]> {
  const roots = [
    ...new Set(
      options.ecosystems.map((ecosystem) =>
        skillRoot({ cwd: options.cwd, homeDir: options.homeDir, ecosystem, scope: options.scope }),
      ),
    ),
  ];
  const skills = await Promise.all(roots.map((root) => discoverSkillsInRoot(root, options.fs)));
  return skills.flat();
}

export async function filterCoveredCandidates(
  candidates: WorkflowCandidate[],
  options: DuplicateSkillScanOptions,
): Promise<{ available: WorkflowCandidate[]; covered: DuplicateSkillMatch[] }> {
  const existingSkills = await discoverExistingSkills(options);
  const covered: DuplicateSkillMatch[] = [];
  const available: WorkflowCandidate[] = [];

  for (const candidate of candidates) {
    const match = bestMatch(candidate, existingSkills);
    if (match !== undefined && match.score >= DUPLICATE_THRESHOLD) {
      covered.push({ candidate, skill: match.skill, score: match.score });
    } else {
      available.push(candidate);
    }
  }

  return { available, covered };
}

async function discoverSkillsInRoot(root: string, fs: FileSystem): Promise<ExistingSkill[]> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const skillPath = path.join(root, entry.name, "SKILL.md");
        try {
          return {
            name: entry.name,
            skillPath,
            text: await fs.readText(skillPath),
          };
        } catch {
          return undefined;
        }
      }),
  );

  return skills.filter((skill): skill is ExistingSkill => skill !== undefined);
}

function bestMatch(
  candidate: WorkflowCandidate,
  skills: ExistingSkill[],
): { skill: ExistingSkill; score: number } | undefined {
  let best: { skill: ExistingSkill; score: number } | undefined;
  for (const skill of skills) {
    const score = duplicateScore(candidate, skill);
    if (best === undefined || score > best.score) {
      best = { skill, score };
    }
  }
  return best;
}

function duplicateScore(candidate: WorkflowCandidate, skill: ExistingSkill): number {
  if (candidate.name === skill.name) {
    return 1;
  }
  const candidateTokens = tokensForText(
    [
      candidate.name,
      candidate.summary,
      ...candidate.representativePrompts.map((prompt) => prompt.text),
    ].join(" "),
  );
  const skillTokens = tokensForText(`${skill.name}\n${skill.text}`);
  if (candidateTokens.size === 0 || skillTokens.size === 0) {
    return 0;
  }
  const intersection = [...candidateTokens].filter((token) => skillTokens.has(token)).length;
  const smallerSetSize = Math.min(candidateTokens.size, skillTokens.size);
  return intersection / smallerSetSize;
}

function tokensForText(text: string): Set<string> {
  const normalized = normalizePrompt({
    id: "duplicate-check",
    source: "codex",
    sourcePath: "",
    text,
  });
  return new Set(normalized.tokens);
}
