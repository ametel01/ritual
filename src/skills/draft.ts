import type { WorkflowCandidate } from "../prompts/types.js";
import type { CommandInvocation, CommandLauncher, CommandRunner } from "../system/exec.js";
import { buildGenerationHandoffPrompt } from "./generation-template.js";
import type { SkillEcosystem, SkillScope } from "./paths.js";

export type DraftExecutable = "claude" | "codex";

export type DraftRequest = {
  candidate: WorkflowCandidate;
  skillName: string;
  scope: SkillScope;
  ecosystems: SkillEcosystem[];
};

export async function detectDraftExecutables(runner: CommandRunner): Promise<DraftExecutable[]> {
  const executables: DraftExecutable[] = [];
  for (const executable of DRAFT_EXECUTABLES) {
    if ((await runner.which(executable)) !== undefined) {
      executables.push(executable);
    }
  }
  return executables;
}

export const DRAFT_EXECUTABLES: readonly DraftExecutable[] = ["claude", "codex"];

export function buildDraftInvocation(
  executable: DraftExecutable,
  prompt: string,
): CommandInvocation {
  if (executable === "claude") {
    return { command: "claude", args: ["--dangerously-skip-permissions", prompt] };
  }
  return { command: "codex", args: ["--yolo", prompt] };
}

export async function launchSkillDraftAgent(options: {
  request: DraftRequest;
  executable: DraftExecutable;
  cwd: string;
  skillPath: string;
  launcher: CommandLauncher;
}): Promise<number> {
  const prompt = buildGenerationHandoffPrompt(options.request, options.skillPath);
  return options.launcher.launch(buildDraftInvocation(options.executable, prompt), {
    cwd: options.cwd,
  });
}
