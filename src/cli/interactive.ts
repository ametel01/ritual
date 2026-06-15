import * as os from "node:os";
import * as path from "node:path";
import { discoverHistorySources, scanHistorySources } from "../history/discover.js";
import type { HistorySource } from "../history/types.js";
import { nearMissCandidates, rankWorkflowCandidates, strongCandidates } from "../prompts/rank.js";
import type { WorkflowCandidate } from "../prompts/types.js";
import {
  buildDraftInvocation,
  candidateLooksTooVague,
  type DraftExecutable,
  detectDraftExecutables,
  launchSkillDraftAgent,
  prepareDraftWorkspace,
} from "../skills/draft.js";
import {
  recommendScope,
  resolveSkillTargets,
  type SkillEcosystem,
  type SkillScope,
  type SkillTarget,
  sanitizeSkillName,
} from "../skills/paths.js";
import { validateSkillDraft } from "../skills/validate.js";
import { writeFinalSkill } from "../skills/write.js";
import { openEditor, type RuntimeEnv } from "../system/editor.js";
import {
  type CommandLauncher,
  type CommandRunner,
  nodeCommandLauncher,
  nodeCommandRunner,
} from "../system/exec.js";
import { type FileSystem, nodeFileSystem } from "../system/filesystem.js";
import { formatDiagnostics, formatSourceSummary } from "../telemetry/diagnostics.js";
import { inquirerPromptAdapter, type PromptAdapter } from "./prompts.js";

export type Output = {
  write(message: string): void;
};

export type InteractiveOptions = {
  cwd?: string;
  homeDir?: string;
  env?: RuntimeEnv;
  prompts?: PromptAdapter;
  output?: Output;
  fs?: FileSystem;
  runner?: CommandRunner;
  launcher?: CommandLauncher;
};

export type SessionResult =
  | { status: "completed"; writtenPaths: string[]; draftPath: string }
  | { status: "cancelled"; reason: string };

export async function runInteractiveSession(
  options: InteractiveOptions = {},
): Promise<SessionResult> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const prompts = options.prompts ?? inquirerPromptAdapter;
  const output = options.output ?? { write: (message: string) => console.log(message) };
  const fs = options.fs ?? nodeFileSystem;
  const runner = options.runner ?? nodeCommandRunner;
  const launcher = options.launcher ?? nodeCommandLauncher;

  output.write("Ritual scans local Claude and Codex history to find repeated workflow prompts.");

  const extraSources = await askForExtraSources(prompts);
  const discovered = await discoverHistorySources({ cwd, homeDir, extraSources });
  for (const line of formatDiagnostics(discovered.diagnostics)) {
    output.write(line);
  }

  const scan = await scanHistorySources(discovered.sources);
  for (const line of formatSourceSummary(scan.sources)) {
    output.write(line);
  }
  for (const line of formatDiagnostics(scan.diagnostics)) {
    output.write(line);
  }

  if (scan.prompts.length === 0) {
    return {
      status: "cancelled",
      reason: "No user prompts were extracted from supported history.",
    };
  }

  const allCandidates = rankWorkflowCandidates(scan.prompts);
  const candidate = await reviewCandidates(prompts, output, allCandidates);
  if (candidate === undefined) {
    return { status: "cancelled", reason: "No candidate was approved." };
  }

  const skillName = sanitizeSkillName(
    await prompts.input("Skill name", sanitizeSkillName(candidate.name)),
  );
  const recommendedScope = recommendScope(candidate, cwd);
  const scope = await prompts.select<SkillScope>("Skill scope", [
    {
      name: `Project-local (${recommendedScope === "project" ? "recommended" : "available"})`,
      value: "project",
    },
    {
      name: `Global (${recommendedScope === "global" ? "recommended" : "available"})`,
      value: "global",
    },
  ]);
  const ecosystems = await prompts.checkbox<SkillEcosystem>("Output ecosystem", [
    { name: "Claude", value: "claude", checked: true },
    { name: "Codex/agents", value: "codex", checked: true },
  ]);
  if (ecosystems.length === 0) {
    return { status: "cancelled", reason: "No output ecosystem was selected." };
  }

  const targets = await resolveSkillTargets({ cwd, homeDir, name: skillName, scope, ecosystems });
  if (!(await confirmRiskyTargets(prompts, targets))) {
    return { status: "cancelled", reason: "Target write was not approved." };
  }

  if (candidateLooksTooVague(candidate)) {
    const continueDraft = await prompts.confirm(
      "This candidate appears vague. Continue drafting anyway?",
      false,
    );
    if (!continueDraft) {
      return { status: "cancelled", reason: "Candidate was too vague to draft." };
    }
  }

  const executable = await chooseDraftExecutable(prompts, runner);
  if (executable === undefined) {
    return {
      status: "cancelled",
      reason: "Neither claude nor codex was found for local draft generation.",
    };
  }

  const draft = await prepareDraftWorkspace({ cwd, skillName, fs });
  const invocationPreview = previewInvocation(executable);
  output.write(`Draft path: ${draft.skillPath}`);
  output.write(`Agent command: ${invocationPreview} <generated skill prompt>`);
  const approveInvocation = await prompts.confirm(
    `Open ${draftExecutableLabel(executable)} in this terminal to draft SKILL.md?`,
    false,
  );
  if (!approveInvocation) {
    return { status: "cancelled", reason: "Draft invocation was not approved." };
  }

  const exitCode = await launchSkillDraftAgent({
    request: { candidate, skillName, scope, ecosystems },
    executable,
    cwd,
    draftPath: draft.skillPath,
    launcher,
  });
  if (exitCode !== 0) {
    return { status: "cancelled", reason: `Draft agent exited with code ${exitCode}.` };
  }
  const draftContent = await fs.readText(draft.skillPath);
  if (draftContent.trim().length === 0) {
    return { status: "cancelled", reason: "Draft agent did not write SKILL.md." };
  }
  output.write(`Draft written to ${draft.skillPath}`);

  await offerEditor({ prompts, output, env, runner, draftPath: draft.skillPath });

  const validation = await validateSkillDraft({ draftDir: draft.draftDir, fs, runner });
  for (const error of validation.errors) {
    output.write(`[error] ${error.message}`);
  }
  for (const warning of validation.warnings) {
    output.write(`[warning] ${warning.message}`);
  }
  if (validation.errors.length > 0) {
    return { status: "cancelled", reason: "Draft validation failed." };
  }
  if (
    validation.warnings.length > 0 &&
    !(await prompts.confirm("Validation produced warnings. Continue to final write?", false))
  ) {
    return { status: "cancelled", reason: "Validation warnings were not approved." };
  }

  if (!(await prompts.confirm("Write the approved skill to the selected targets?", false))) {
    return { status: "cancelled", reason: "Final write was not approved." };
  }

  const approvedContent = await fs.readText(draft.skillPath);
  const writtenPaths = await writeFinalSkill({ targets, content: approvedContent, fs });
  for (const writtenPath of writtenPaths) {
    output.write(`Wrote ${writtenPath}`);
  }

  const keepDraft = await prompts.confirm("Keep the draft workspace?", true);
  if (!keepDraft) {
    await fs.removeDir(path.join(cwd, ".ritual", "drafts", skillName));
  }

  return { status: "completed", writtenPaths, draftPath: draft.skillPath };
}

async function askForExtraSources(prompts: PromptAdapter): Promise<HistorySource[]> {
  const addExtra = await prompts.confirm("Add an extra history file or directory?", false);
  if (!addExtra) {
    return [];
  }
  const kind = await prompts.select<HistorySource["kind"]>("Extra source type", [
    { name: "Claude", value: "claude" },
    { name: "Codex", value: "codex" },
  ]);
  const sourcePath = await prompts.input("Extra history path");
  return sourcePath.trim().length === 0 ? [] : [{ kind, path: sourcePath.trim() }];
}

async function reviewCandidates(
  prompts: PromptAdapter,
  output: Output,
  candidates: WorkflowCandidate[],
): Promise<WorkflowCandidate | undefined> {
  let pool = strongCandidates(candidates);
  if (pool.length === 0) {
    const nearMisses = nearMissCandidates(candidates);
    output.write("Ritual did not find any workflows repeated three or more times.");
    if (
      nearMisses.length === 0 ||
      !(await prompts.confirm("Review workflows that appeared twice?", false))
    ) {
      return undefined;
    }
    pool = nearMisses;
  }

  while (pool.length > 0) {
    const choice = await prompts.select("Choose a repeated workflow", [
      ...pool.map((candidate) => ({
        name: candidateMenuLabel(candidate),
        value: candidate.id,
        description: candidateMenuDescription(candidate),
      })),
      { name: "Exit without generating", value: "exit" },
    ]);
    if (choice === "exit") {
      return undefined;
    }
    const selected = pool.find((candidate) => candidate.id === choice);
    if (selected === undefined) {
      return undefined;
    }

    showCandidate(output, selected);
    return selected;
  }

  return undefined;
}

function showCandidate(output: Output, candidate: WorkflowCandidate): void {
  output.write(`Suggested skill name: ${candidate.name}`);
  output.write(`Found ${candidate.count} similar prompt${candidate.count === 1 ? "" : "s"}.`);
  output.write(`What it looks like: ${candidate.summary}`);
  output.write(`Confidence: ${candidate.isStrong ? "good" : "possible"}`);
  output.write("Matching prompts found locally:");
  for (const prompt of candidate.representativePrompts) {
    output.write(`- ${prompt.text}`);
  }
  output.write("Next, Ritual will draft a skill from this workflow using your local agent.");
}

function candidateMenuLabel(candidate: WorkflowCandidate): string {
  const label =
    candidate.summary.length <= 76 ? candidate.summary : `${candidate.summary.slice(0, 73)}...`;
  return `${label} (${candidate.count} prompt${candidate.count === 1 ? "" : "s"})`;
}

function candidateMenuDescription(candidate: WorkflowCandidate): string {
  return candidate.isStrong
    ? "Ritual saw this pattern several times."
    : "Ritual saw this pattern twice.";
}

async function chooseDraftExecutable(
  prompts: PromptAdapter,
  runner: CommandRunner,
): Promise<DraftExecutable | undefined> {
  const availableExecutables = await detectDraftExecutables(runner);
  if (availableExecutables.length === 0) {
    return undefined;
  }

  return prompts.select<DraftExecutable>("Generate the draft with", [
    ...availableExecutables.map((executable) => ({
      name: draftExecutableLabel(executable),
      value: executable,
      description: `Run ${draftExecutableCommand(executable)} locally with the skill-generation prompt`,
    })),
  ]);
}

function draftExecutableLabel(executable: DraftExecutable): string {
  return executable === "claude" ? "Claude Code" : "Codex";
}

function draftExecutableCommand(executable: DraftExecutable): string {
  return executable === "claude" ? "claude" : "codex";
}

async function confirmRiskyTargets(
  prompts: PromptAdapter,
  targets: SkillTarget[],
): Promise<boolean> {
  const globalTargets = targets.filter((target) => target.scope === "global");
  if (
    globalTargets.length > 0 &&
    !(await prompts.confirm("Global skill writes affect future agent sessions. Continue?", false))
  ) {
    return false;
  }

  const existing = targets.filter((target) => target.exists);
  if (existing.length === 0) {
    return true;
  }
  return prompts.confirm(
    `Overwrite ${existing.length} existing skill target${existing.length === 1 ? "" : "s"}?`,
    false,
  );
}

async function offerEditor(options: {
  prompts: PromptAdapter;
  output: Output;
  env: RuntimeEnv;
  runner: CommandRunner;
  draftPath: string;
}): Promise<void> {
  if (options.env.EDITOR === undefined) {
    options.output.write("$EDITOR is not set; continuing with prompt-based review.");
    return;
  }
  if (await options.prompts.confirm("Open draft in $EDITOR before validation?", true)) {
    const result = await openEditor({
      filePath: options.draftPath,
      env: options.env,
      runner: options.runner,
    });
    options.output.write(result.message);
  }
}

function previewInvocation(executable: DraftExecutable): string {
  const invocation = buildDraftInvocation(executable, "");
  const argsWithoutPrompt = invocation.args.slice(0, -1);
  return [invocation.command, ...argsWithoutPrompt].join(" ");
}
