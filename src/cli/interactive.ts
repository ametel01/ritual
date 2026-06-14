import * as os from "node:os";
import * as path from "node:path";
import { discoverHistorySources, scanHistorySources } from "../history/discover.js";
import type { HistorySource } from "../history/types.js";
import { mergeCandidates } from "../prompts/cluster.js";
import { nearMissCandidates, rankWorkflowCandidates, strongCandidates } from "../prompts/rank.js";
import type { WorkflowCandidate } from "../prompts/types.js";
import {
  buildDraftInvocation,
  candidateLooksTooVague,
  createSkillDraft,
  type DraftExecutable,
  detectDraftExecutable,
  writeDraftWorkspace,
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
import { type CommandRunner, nodeCommandRunner } from "../system/exec.js";
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

  const executable = await detectDraftExecutable(runner);
  if (executable === undefined) {
    return {
      status: "cancelled",
      reason: "Neither claude nor codex was found for local draft generation.",
    };
  }

  const invocationPreview = previewInvocation(executable, candidate, skillName, scope, ecosystems);
  output.write(`Draft invocation: ${invocationPreview}`);
  const approveInvocation = await prompts.confirm(
    "Run this local agent executable to draft SKILL.md?",
    false,
  );
  if (!approveInvocation) {
    return { status: "cancelled", reason: "Draft invocation was not approved." };
  }

  const draftContent = await createSkillDraft({
    request: { candidate, skillName, scope, ecosystems },
    runner,
    executable,
  });
  const draft = await writeDraftWorkspace({ cwd, skillName, content: draftContent, fs });
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
    output.write("No strong candidates met the default recurrence threshold.");
    if (
      nearMisses.length === 0 ||
      !(await prompts.confirm("Review near-miss candidates with two similar prompts?", false))
    ) {
      return undefined;
    }
    pool = nearMisses;
  }

  while (pool.length > 0) {
    const choice = await prompts.select("Review candidate", [
      ...pool.map((candidate) => ({
        name: `${candidate.name} (${candidate.count})`,
        value: candidate.id,
        description: candidate.rankReason,
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
    const action = await prompts.select("Candidate action", [
      { name: "Approve", value: "approve" },
      { name: "Rename", value: "rename" },
      { name: "Merge", value: "merge" },
      { name: "Reject", value: "reject" },
      { name: "Back", value: "back" },
    ]);

    if (action === "approve") {
      return selected;
    }
    if (action === "rename") {
      const name = await prompts.input("Candidate name", selected.name);
      selected.name = sanitizeSkillName(name);
      continue;
    }
    if (action === "merge") {
      const other = await chooseMergeCandidate(prompts, pool, selected);
      if (other !== undefined) {
        pool = pool.filter(
          (candidate) => candidate.id !== selected.id && candidate.id !== other.id,
        );
        pool.unshift(mergeCandidates(selected, other));
      }
      continue;
    }
    if (action === "reject") {
      pool = pool.filter((candidate) => candidate.id !== selected.id);
    }
  }

  return undefined;
}

function showCandidate(output: Output, candidate: WorkflowCandidate): void {
  output.write(`Name: ${candidate.name}`);
  output.write(`Count: ${candidate.count}`);
  output.write(`Summary: ${candidate.summary}`);
  output.write(`Rank: ${candidate.rankReason}`);
  output.write("Representative prompts:");
  for (const prompt of candidate.representativePrompts) {
    output.write(`- ${prompt.text}`);
  }
}

async function chooseMergeCandidate(
  prompts: PromptAdapter,
  candidates: WorkflowCandidate[],
  selected: WorkflowCandidate,
): Promise<WorkflowCandidate | undefined> {
  const mergeable = candidates.filter((candidate) => candidate.id !== selected.id);
  if (mergeable.length === 0) {
    return undefined;
  }
  const choice = await prompts.select("Merge with", [
    ...mergeable.map((candidate) => ({
      name: `${candidate.name} (${candidate.count})`,
      value: candidate.id,
    })),
    { name: "Cancel merge", value: "cancel" },
  ]);
  return choice === "cancel" ? undefined : mergeable.find((candidate) => candidate.id === choice);
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

function previewInvocation(
  executable: DraftExecutable,
  candidate: WorkflowCandidate,
  skillName: string,
  scope: SkillScope,
  ecosystems: SkillEcosystem[],
): string {
  const invocation = buildDraftInvocation(
    executable,
    `${candidate.name}:${skillName}:${scope}:${ecosystems.join(",")}`,
  );
  return `${invocation.command} ${invocation.args.map((arg) => (arg.length > 60 ? `${arg.slice(0, 57)}...` : arg)).join(" ")}`;
}
