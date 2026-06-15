import type { CommandRunner } from "../system/exec.js";

export const CLI_AGENT_BINARIES = {
  "claude-code": "claude",
  codex: "codex",
  cursor: "cursor-agent",
} as const;

export type CliAgentId = keyof typeof CLI_AGENT_BINARIES;

const CODING_AGENT_ENV_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "CODEX_CI",
  "CODEX_SANDBOX",
  "OPENCODE",
  "GOOSE_TERMINAL",
  "AMP_THREAD_ID",
  "AGENT_SESSION_ID",
  "AGENT_THREAD_ID",
] as const;

export type Environment = Record<string, string | undefined> & {
  readonly AGENT?: string;
  readonly CI?: string;
};

export function isCiOrCodingAgentEnvironment(env: Environment = process.env): boolean {
  if (env.CI !== undefined && env.CI !== "false") {
    return true;
  }
  if (env.AGENT === "amp" || env.AGENT === "goose") {
    return true;
  }
  return CODING_AGENT_ENV_MARKERS.some((marker) => env[marker] !== undefined);
}

export async function detectLaunchableAgents(runner: CommandRunner): Promise<CliAgentId[]> {
  const agents: CliAgentId[] = [];
  for (const agentId of Object.keys(CLI_AGENT_BINARIES) as CliAgentId[]) {
    const binary = CLI_AGENT_BINARIES[agentId];
    if ((await runner.which(binary)) !== undefined) {
      agents.push(agentId);
    }
  }
  return agents;
}
