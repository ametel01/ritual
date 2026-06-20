import * as os from "node:os";
import * as path from "node:path";
import { discoverHistorySources, scanHistorySources } from "../history/discover.js";
import type { HistorySource } from "../history/types.js";
import {
  nearMissCandidates,
  rankWorkflowCandidatesAsync,
  strongCandidates,
} from "../prompts/rank.js";
import type { WorkflowCandidate } from "../prompts/types.js";
import {
  agentDiscoveryReportPath,
  launchAgentDiscovery,
  parseAgentDiscoveryReport,
} from "../skills/agent-discovery.js";
import {
  buildDraftInvocation,
  type DraftExecutable,
  detectDraftExecutables,
  launchSkillDraftAgent,
} from "../skills/draft.js";
import { filterCoveredCandidates } from "../skills/duplicates.js";
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
import type { RuntimeEnv } from "../system/editor.js";
import {
  type CommandLauncher,
  type CommandRunner,
  nodeCommandLauncher,
  nodeCommandRunner,
} from "../system/exec.js";
import { type FileSystem, nodeFileSystem } from "../system/filesystem.js";
import { formatDiagnostics, formatSourceSummary } from "../telemetry/diagnostics.js";
import { inquirerPromptAdapter, type PromptAdapter } from "./prompts.js";
import { createSpinnerFactory, type SpinnerFactory } from "./spinner.js";

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
  spinner?: SpinnerFactory;
};

export type SessionResult =
  | { status: "completed"; writtenPaths: string[]; skillPath: string }
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
  const spinner = options.spinner ?? createSpinnerFactory({ env });

  output.write("Ritual scans local Claude and Codex history to find repeated workflow prompts.");

  const discovered = await withSpinner(spinner, "Finding local history sources...", () =>
    discoverHistorySources({ cwd, homeDir, env }),
  );
  let sources = discovered.sources;
  if (sources.length === 0) {
    const extraSources = await askForExtraSources(prompts);
    if (extraSources.length > 0) {
      const withExtra = await withSpinner(spinner, "Finding extra history sources...", () =>
        discoverHistorySources({ cwd, homeDir, env, extraSources }),
      );
      sources = withExtra.sources;
      discovered.diagnostics.push(...withExtra.diagnostics);
    }
  }

  for (const line of formatDiagnostics(discovered.diagnostics.filter(isErrorDiagnostic))) {
    output.write(line);
  }

  const scan = await withSpinner(spinner, "Parsing history...", () => scanHistorySources(sources));
  for (const line of formatSourceSummary(scan.sources)) {
    output.write(line);
  }
  for (const line of formatDiagnostics(scan.diagnostics.filter(isErrorDiagnostic))) {
    output.write(line);
  }

  const agentDiscovery = await selectAgentDiscoveredCandidate({
    prompts,
    output,
    sources,
    cwd,
    homeDir,
    fs,
    runner,
    launcher,
    spinner,
  });
  if (agentDiscovery.status === "cancelled") {
    return { status: "cancelled", reason: "No candidate was approved." };
  }
  if (agentDiscovery.status === "fallback") {
    output.write(agentDiscovery.reason);
    if (scan.prompts.length === 0) {
      return {
        status: "cancelled",
        reason: "No user prompts were extracted from supported history.",
      };
    }
  }

  const candidate =
    agentDiscovery.status === "selected"
      ? agentDiscovery.candidate
      : await selectLocallyRankedCandidate({
          prompts,
          output,
          scanPrompts: scan.prompts,
          cwd,
          homeDir,
          fs,
          spinner,
        });
  if (candidate === undefined) {
    return { status: "cancelled", reason: "No candidate was approved." };
  }

  const skillName = sanitizeSkillName(
    await prompts.input("Skill name", sanitizeSkillName(candidate.name)),
  );
  const recommendedScope = candidate.recommendedScope ?? recommendScope(candidate, cwd);
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
  if (!(await confirmExistingTargets(prompts, targets))) {
    return { status: "cancelled", reason: "Target write was not approved." };
  }

  const executable = await chooseDraftExecutable(prompts, runner);
  if (executable === undefined) {
    return {
      status: "cancelled",
      reason: "Neither claude nor codex was found for local draft generation.",
    };
  }

  const primaryTarget = targets[0];
  if (primaryTarget === undefined) {
    return { status: "cancelled", reason: "No output ecosystem was selected." };
  }
  const invocationPreview = previewInvocation(executable);
  output.write(`Skill path: ${primaryTarget.skillPath}`);
  output.write(`Agent command: ${invocationPreview} <generated skill prompt>`);

  const exitCode = await launchSkillDraftAgent({
    request: { candidate, skillName, scope, ecosystems },
    executable,
    cwd,
    skillPath: primaryTarget.skillPath,
    launcher,
  });
  if (exitCode !== 0) {
    return { status: "cancelled", reason: `Skill agent exited with code ${exitCode}.` };
  }
  const skillContent = await fs.readText(primaryTarget.skillPath);
  if (skillContent.trim().length === 0) {
    return { status: "cancelled", reason: "Skill agent did not write SKILL.md." };
  }
  output.write(`Skill written to ${primaryTarget.skillPath}`);

  const validation = await validateSkillDraft({ draftDir: primaryTarget.skillDir, fs, runner });
  for (const error of validation.errors) {
    output.write(`[error] ${error.message}`);
  }
  if (validation.errors.length > 0) {
    return { status: "cancelled", reason: "Skill validation failed." };
  }

  const additionalTargets = targets.slice(1);
  const additionalWrittenPaths = await writeFinalSkill({
    targets: additionalTargets,
    content: skillContent,
    fs,
  });
  const writtenPaths = [primaryTarget.skillPath, ...additionalWrittenPaths];
  for (const writtenPath of writtenPaths.slice(1)) {
    output.write(`Wrote ${writtenPath}`);
  }

  return { status: "completed", writtenPaths, skillPath: primaryTarget.skillPath };
}

async function removeCoveredCandidates(options: {
  candidates: WorkflowCandidate[];
  cwd: string;
  homeDir: string;
  fs: FileSystem;
  output: Output;
}): Promise<WorkflowCandidate[]> {
  const projectMatches = await filterCoveredCandidates(options.candidates, {
    cwd: options.cwd,
    homeDir: options.homeDir,
    scope: "project",
    ecosystems: ["claude", "codex"],
    fs: options.fs,
  });
  const globalMatches = await filterCoveredCandidates(projectMatches.available, {
    cwd: options.cwd,
    homeDir: options.homeDir,
    scope: "global",
    ecosystems: ["claude", "codex"],
    fs: options.fs,
  });
  const coveredCount = projectMatches.covered.length + globalMatches.covered.length;
  if (coveredCount > 0) {
    options.output.write(
      `Skipped ${coveredCount} repeated workflow${coveredCount === 1 ? "" : "s"} already covered by existing skills.`,
    );
  }
  return globalMatches.available;
}

type CandidateDiscoverySelection =
  | { status: "selected"; candidate: WorkflowCandidate }
  | { status: "fallback"; reason: string }
  | { status: "cancelled" };

async function selectAgentDiscoveredCandidate(options: {
  prompts: PromptAdapter;
  output: Output;
  sources: HistorySource[];
  cwd: string;
  homeDir: string;
  fs: FileSystem;
  runner: CommandRunner;
  launcher: CommandLauncher;
  spinner: SpinnerFactory;
}): Promise<CandidateDiscoverySelection> {
  if (options.sources.length === 0) {
    return {
      status: "fallback",
      reason: "No history sources were available for agent discovery.",
    };
  }

  const useAgentDiscovery = await options.prompts.confirm(
    "Use a local agent to inspect history for skill candidates?",
    true,
  );
  if (!useAgentDiscovery) {
    return { status: "fallback", reason: "Using Ritual's local repeated-workflow ranking." };
  }

  const executable = await chooseDiscoveryExecutable(options.prompts, options.runner);
  if (executable === undefined) {
    return {
      status: "fallback",
      reason:
        "No local agent executable was found, so Ritual is using local repeated-workflow ranking.",
    };
  }

  const reportPath = agentDiscoveryReportPath(options.cwd);
  await options.fs.ensureDir(path.dirname(reportPath));
  const invocationPreview = previewInvocation(executable);
  options.output.write(`Discovery report: ${reportPath}`);
  options.output.write(`Agent command: ${invocationPreview} <generated discovery prompt>`);

  const exitCode = await launchAgentDiscovery({
    cwd: options.cwd,
    sources: options.sources,
    reportPath,
    executable,
    launcher: options.launcher,
  });
  if (exitCode !== 0) {
    return {
      status: "fallback",
      reason: `Discovery agent exited with code ${exitCode}, so Ritual is using local repeated-workflow ranking.`,
    };
  }

  let reportContent: string;
  try {
    reportContent = await options.fs.readText(reportPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown read error";
    return {
      status: "fallback",
      reason: `Discovery agent did not write a readable report (${message}), so Ritual is using local repeated-workflow ranking.`,
    };
  }

  const parsed = parseAgentDiscoveryReport(reportContent, options.sources);
  for (const warning of parsed.warnings) {
    options.output.write(`[warning] ${warning}`);
  }
  if (parsed.candidates.length === 0) {
    return {
      status: "fallback",
      reason:
        "Discovery agent did not return skill candidates, so Ritual is using local repeated-workflow ranking.",
    };
  }

  const uncoveredCandidates = await removeCoveredCandidates({
    candidates: parsed.candidates,
    cwd: options.cwd,
    homeDir: options.homeDir,
    fs: options.fs,
    output: options.output,
  });
  if (uncoveredCandidates.length === 0) {
    return {
      status: "fallback",
      reason:
        "All agent-discovered candidates are already covered by existing skills, so Ritual is using local repeated-workflow ranking.",
    };
  }

  options.output.write(
    `Agent found ${uncoveredCandidates.length} skill candidate${uncoveredCandidates.length === 1 ? "" : "s"}.`,
  );
  const candidate = await reviewCandidates(options.prompts, options.output, uncoveredCandidates);
  if (candidate === undefined) {
    return { status: "cancelled" };
  }
  return { status: "selected", candidate };
}

async function selectLocallyRankedCandidate(options: {
  prompts: PromptAdapter;
  output: Output;
  scanPrompts: Parameters<typeof rankWorkflowCandidatesAsync>[0];
  cwd: string;
  homeDir: string;
  fs: FileSystem;
  spinner: SpinnerFactory;
}): Promise<WorkflowCandidate | undefined> {
  const allCandidates = await withSpinner(options.spinner, "Ranking repeated workflows...", () =>
    rankWorkflowCandidatesAsync(options.scanPrompts),
  );
  const uncoveredCandidates = await removeCoveredCandidates({
    candidates: allCandidates,
    cwd: options.cwd,
    homeDir: options.homeDir,
    fs: options.fs,
    output: options.output,
  });
  return reviewCandidates(options.prompts, options.output, uncoveredCandidates);
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
  if (candidate.discoverySource === "agent") {
    output.write(`Agent confidence: ${candidate.confidence ?? "unknown"}.`);
  } else {
    output.write(`Found ${candidate.count} similar prompt${candidate.count === 1 ? "" : "s"}.`);
  }
  output.write(`What it looks like: ${candidate.summary}`);
  output.write(
    candidate.discoverySource === "agent"
      ? `Why it may be worth a skill: ${candidate.rankReason}`
      : `Confidence: ${candidate.isStrong ? "good" : "possible"}`,
  );
  output.write(
    candidate.discoverySource === "agent"
      ? "Representative workflow examples:"
      : "Matching prompts found locally:",
  );
  for (const prompt of candidate.representativePrompts) {
    output.write(`- ${prompt.text}`);
  }
  output.write("Next, Ritual will open a local agent to write this skill.");
}

function candidateMenuLabel(candidate: WorkflowCandidate): string {
  const label =
    candidate.summary.length <= 76 ? candidate.summary : `${candidate.summary.slice(0, 73)}...`;
  return `${label} (${candidate.count} prompt${candidate.count === 1 ? "" : "s"})`;
}

function candidateMenuDescription(candidate: WorkflowCandidate): string {
  if (candidate.discoverySource === "agent") {
    return `Agent confidence: ${candidate.confidence ?? "unknown"}.`;
  }
  return candidate.isStrong
    ? "Ritual saw this pattern several times."
    : "Ritual saw this pattern twice.";
}

async function chooseDiscoveryExecutable(
  prompts: PromptAdapter,
  runner: CommandRunner,
): Promise<DraftExecutable | undefined> {
  const availableExecutables = await detectDraftExecutables(runner);
  if (availableExecutables.length === 0) {
    return undefined;
  }

  return prompts.select<DraftExecutable>("Analyze history with", [
    ...availableExecutables.map((executable) => ({
      name: draftExecutableLabel(executable),
      value: executable,
      description: `Run ${draftExecutableCommand(executable)} locally with the discovery prompt`,
    })),
  ]);
}

async function chooseDraftExecutable(
  prompts: PromptAdapter,
  runner: CommandRunner,
): Promise<DraftExecutable | undefined> {
  const availableExecutables = await detectDraftExecutables(runner);
  if (availableExecutables.length === 0) {
    return undefined;
  }

  return prompts.select<DraftExecutable>("Open agent with", [
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

async function confirmExistingTargets(
  prompts: PromptAdapter,
  targets: SkillTarget[],
): Promise<boolean> {
  const existing = targets.filter((target) => target.exists);
  if (existing.length === 0) {
    return true;
  }
  return prompts.confirm(
    `Overwrite ${existing.length} existing skill target${existing.length === 1 ? "" : "s"}?`,
    false,
  );
}

function previewInvocation(executable: DraftExecutable): string {
  const invocation = buildDraftInvocation(executable, "");
  const argsWithoutPrompt = invocation.args.slice(0, -1);
  return [invocation.command, ...argsWithoutPrompt].join(" ");
}

function isErrorDiagnostic(diagnostic: { level: string }): boolean {
  return diagnostic.level === "error";
}

async function withSpinner<T>(
  spinner: SpinnerFactory,
  text: string,
  operation: () => Promise<T>,
): Promise<T> {
  const handle = spinner.start(text);
  try {
    const result = await operation();
    handle.succeed(text);
    return result;
  } catch (error) {
    handle.fail(text);
    throw error;
  }
}
