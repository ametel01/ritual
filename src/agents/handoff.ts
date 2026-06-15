import type { PromptAdapter } from "../cli/prompts.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { buildHandoffPayload } from "../prompts/build-handoff-payload.js";
import type { CommandRunner } from "../system/exec.js";
import { type ClipboardRunner, copyPromptToClipboard, printPromptFallback } from "./clipboard.js";
import {
  CLI_AGENT_BINARIES,
  type CliAgentId,
  detectLaunchableAgents,
  type Environment,
  isCiOrCodingAgentEnvironment,
} from "./detect.js";
import { launchCliAgent, type SpawnAgent } from "./launch.js";

export type HandoffTarget = CliAgentId | "clipboard" | "skip";

export type HandoffOutput = {
  write(message: string): void;
};

export type HandoffResult =
  | { status: "launched"; agentId: CliAgentId; exitCode: number; ciOutcome: "ci-yes" | "ci-no" }
  | { status: "copied"; copied: boolean; ciOutcome: "ci-yes" | "ci-no" }
  | { status: "skipped"; ciOutcome: "ci-yes" | "ci-no" };

export type HandoffInput = {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly projectName: string;
  readonly rootDirectory: string;
  readonly interactive: boolean;
  readonly outputDirectory?: string | null;
  readonly prompts: PromptAdapter;
  readonly runner: CommandRunner;
  readonly output?: HandoffOutput;
  readonly clipboardRunner?: ClipboardRunner;
  readonly spawner?: SpawnAgent;
  readonly installSkillForAgent?: (agentId: CliAgentId, projectRoot: string) => Promise<boolean>;
};

export type HandoffGateInput = {
  readonly isQuiet: boolean;
  readonly skipPrompts: boolean;
  readonly stdoutIsTty: boolean;
  readonly env?: Environment;
  readonly selectedDiagnostics: ReadonlyArray<Diagnostic>;
};

export function shouldOfferInteractiveHandoff(input: HandoffGateInput): boolean {
  return (
    !input.isQuiet &&
    !input.skipPrompts &&
    input.stdoutIsTty &&
    !isCiOrCodingAgentEnvironment(input.env) &&
    input.selectedDiagnostics.length > 0
  );
}

export async function handoffToAgent(input: HandoffInput): Promise<HandoffResult> {
  const output = input.output ?? { write: (message: string) => console.log(message) };
  const addCi = await input.prompts.confirm(
    "Add React Doctor to GitHub Actions before fixing these findings?",
    false,
  );
  const ciOutcome = addCi ? "ci-yes" : "ci-no";
  if (addCi) {
    output.write("Run `npx react-doctor install --yes` or add the GitHub Actions workflow.");
  }

  const prompt = buildHandoffPayload({
    diagnostics: input.diagnostics,
    projectName: input.projectName,
    outputDirectory: input.outputDirectory ?? null,
  });
  const launchableAgents = await detectLaunchableAgents(input.runner);
  const handoffTarget = await input.prompts.select<HandoffTarget>(
    "What would you like to do next?",
    [
      ...launchableAgents.map((agentId) => ({
        name: getAgentDisplayName(agentId),
        description: `Open ${CLI_AGENT_BINARIES[agentId]} here with the top issues as a prompt`,
        value: agentId,
      })),
      {
        name: "Copy prompt to clipboard",
        description: "Paste into any agent or chat",
        value: "clipboard" as const,
      },
      { name: "Skip", description: "Don't hand off", value: "skip" as const },
    ],
  );

  if (handoffTarget === "skip") {
    return { status: "skipped", ciOutcome };
  }
  if (handoffTarget === "clipboard") {
    const copied = await copyPromptToClipboard(prompt, input.clipboardRunner, output);
    return { status: "copied", copied, ciOutcome };
  }

  await input.installSkillForAgent?.(handoffTarget, input.rootDirectory);
  try {
    const exitCode = await launchCliAgent(
      handoffTarget,
      prompt,
      input.rootDirectory,
      input.spawner,
    );
    return { status: "launched", agentId: handoffTarget, exitCode, ciOutcome };
  } catch {
    output.write(`Could not launch ${getAgentDisplayName(handoffTarget)}.`);
    printPromptFallback(prompt, output);
    return { status: "launched", agentId: handoffTarget, exitCode: 1, ciOutcome };
  }
}

function getAgentDisplayName(agentId: CliAgentId): string {
  switch (agentId) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
  }
}
