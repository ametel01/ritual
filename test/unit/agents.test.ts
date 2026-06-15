import { copyPromptToClipboard } from "../../src/agents/clipboard.js";
import {
  CLI_AGENT_BINARIES,
  detectLaunchableAgents,
  isCiOrCodingAgentEnvironment,
} from "../../src/agents/detect.js";
import { handoffToAgent, shouldOfferInteractiveHandoff } from "../../src/agents/handoff.js";
import { launchCliAgent } from "../../src/agents/launch.js";
import type { PromptAdapter } from "../../src/cli/prompts.js";
import type { Diagnostic } from "../../src/diagnostics/types.js";
import type { CommandInvocation, CommandResult, CommandRunner } from "../../src/system/exec.js";

function diagnostic(): Diagnostic {
  return {
    filePath: "src/App.tsx",
    plugin: "react-doctor",
    rule: "stable-props",
    severity: "error",
    title: "Avoid unstable props",
    message: "A component receives unstable props.",
    help: "Memoize the value or move it outside render.",
    line: 10,
    column: 3,
    category: "Performance",
  };
}

class QueuePrompts implements PromptAdapter {
  constructor(
    private readonly confirms: boolean[],
    private readonly selects: string[],
  ) {}

  async confirm(): Promise<boolean> {
    const value = this.confirms.shift();
    if (value === undefined) {
      throw new Error("Missing confirm answer.");
    }
    return value;
  }

  async input(): Promise<string> {
    throw new Error("not used");
  }

  async select<Value extends string>(): Promise<Value> {
    const value = this.selects.shift();
    if (value === undefined) {
      throw new Error("Missing select answer.");
    }
    return value as Value;
  }

  async checkbox<Value extends string>(): Promise<Value[]> {
    throw new Error("not used");
  }
}

function runnerWithAvailableCommands(commands: string[]): CommandRunner {
  return {
    async which(command: string): Promise<string | undefined> {
      return commands.includes(command) ? `/usr/local/bin/${command}` : undefined;
    },
    async run(_invocation: CommandInvocation): Promise<CommandResult> {
      throw new Error("not used");
    },
  };
}

describe("agent detection", () => {
  it("detects CI and coding-agent environments", () => {
    expect(isCiOrCodingAgentEnvironment({ CI: "true" })).toBe(true);
    expect(isCiOrCodingAgentEnvironment({ CODEX_SANDBOX: "1" })).toBe(true);
    expect(isCiOrCodingAgentEnvironment({ AGENT: "goose" })).toBe(true);
    expect(isCiOrCodingAgentEnvironment({ CI: "false" })).toBe(false);
  });

  it("detects launchable agents in stable order from PATH", async () => {
    await expect(
      detectLaunchableAgents(runnerWithAvailableCommands(["codex", "claude", "cursor-agent"])),
    ).resolves.toEqual(["claude-code", "codex", "cursor"]);
  });
});

describe("agent launch", () => {
  it.each([
    ["claude-code", "claude", ["--dangerously-skip-permissions", "fix it"]],
    ["codex", "codex", ["--yolo", "fix it"]],
    ["cursor", "cursor-agent", ["--force", "fix it"]],
  ] as const)("builds exact argv for %s", async (agentId, expectedCommand, expectedArgs) => {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
    const exitCode = await launchCliAgent(
      agentId,
      "fix it",
      "/repo",
      async (command, args, cwd) => {
        calls.push({ command, args, cwd });
        return 0;
      },
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ command: expectedCommand, args: expectedArgs, cwd: "/repo" }]);
  });
});

describe("clipboard fallback", () => {
  it("prints the prompt when no clipboard command exists", async () => {
    const output: string[] = [];
    const copied = await copyPromptToClipboard(
      "prompt body",
      {
        async which(): Promise<string | undefined> {
          return undefined;
        },
        async runWithInput(): Promise<void> {
          throw new Error("not used");
        },
      },
      { write: (message) => output.push(message) },
    );

    expect(copied).toBe(false);
    expect(output).toContain("prompt body");
  });
});

describe("handoff gate", () => {
  it("skips JSON, score-only, non-TTY, CI, coding-agent, and empty-diagnostic runs", () => {
    const base = {
      isQuiet: false,
      skipPrompts: false,
      stdoutIsTty: true,
      env: {},
      selectedDiagnostics: [diagnostic()],
    };

    expect(shouldOfferInteractiveHandoff(base)).toBe(true);
    expect(shouldOfferInteractiveHandoff({ ...base, isQuiet: true })).toBe(false);
    expect(shouldOfferInteractiveHandoff({ ...base, skipPrompts: true })).toBe(false);
    expect(shouldOfferInteractiveHandoff({ ...base, stdoutIsTty: false })).toBe(false);
    expect(shouldOfferInteractiveHandoff({ ...base, env: { CI: "true" } })).toBe(false);
    expect(shouldOfferInteractiveHandoff({ ...base, env: { CLAUDE_CODE: "1" } })).toBe(false);
    expect(shouldOfferInteractiveHandoff({ ...base, selectedDiagnostics: [] })).toBe(false);
  });
});

describe("handoff flow", () => {
  it("copies the generated prompt without launching an agent", async () => {
    const output: string[] = [];
    const result = await handoffToAgent({
      diagnostics: [diagnostic()],
      projectName: "example-app",
      rootDirectory: "/repo",
      interactive: true,
      prompts: new QueuePrompts([false], ["clipboard"]),
      runner: runnerWithAvailableCommands([]),
      clipboardRunner: {
        async which(command): Promise<string | undefined> {
          return command === "pbcopy" ? "/usr/bin/pbcopy" : undefined;
        },
        async runWithInput(_command, _args, input): Promise<void> {
          output.push(input);
        },
      },
    });

    expect(result).toEqual({ status: "copied", copied: true, ciOutcome: "ci-no" });
    expect(output[0]).toContain("Fix the top 1 React Doctor issue in example-app");
  });

  it("installs the skill best-effort and spawns the selected agent in the project root", async () => {
    const installs: string[] = [];
    const spawns: Array<{ command: string; cwd: string }> = [];
    const result = await handoffToAgent({
      diagnostics: [diagnostic()],
      projectName: "example-app",
      rootDirectory: "/repo",
      interactive: true,
      prompts: new QueuePrompts([true], ["codex"]),
      runner: runnerWithAvailableCommands(["codex"]),
      output: { write: () => undefined },
      async installSkillForAgent(agentId, projectRoot): Promise<boolean> {
        installs.push(`${agentId}:${projectRoot}`);
        return false;
      },
      async spawner(command, _args, cwd): Promise<number> {
        spawns.push({ command, cwd });
        return 0;
      },
    });

    expect(result).toEqual({
      status: "launched",
      agentId: "codex",
      exitCode: 0,
      ciOutcome: "ci-yes",
    });
    expect(installs).toEqual(["codex:/repo"]);
    expect(spawns).toEqual([{ command: CLI_AGENT_BINARIES.codex, cwd: "/repo" }]);
  });
});
