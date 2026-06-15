import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { CLI_AGENT_BINARIES, type CliAgentId } from "./detect.js";

export const CLI_AGENT_AUTO_FLAGS = {
  "claude-code": ["--dangerously-skip-permissions"],
  codex: ["--yolo"],
  cursor: ["--force"],
} as const satisfies Record<CliAgentId, readonly string[]>;

export type SpawnAgent = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  shell?: boolean,
) => Promise<number>;

export const spawnAgent: SpawnAgent = (command, args, cwd, shell = false) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit", shell });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });

export async function launchCliAgent(
  agentId: CliAgentId,
  prompt: string,
  cwd: string,
  spawner: SpawnAgent = spawnAgent,
): Promise<number> {
  const binary = CLI_AGENT_BINARIES[agentId];
  const agentArgs = [...CLI_AGENT_AUTO_FLAGS[agentId], prompt];
  const windowsEntrypoint = resolveWindowsCmdEntrypoint(binary);
  if (windowsEntrypoint === null) {
    return spawner(binary, agentArgs, cwd);
  }
  return spawner(process.execPath, [windowsEntrypoint, ...agentArgs], cwd);
}

function resolveWindowsCmdEntrypoint(binary: string): string | null {
  if (process.platform !== "win32" || !binary.endsWith(".cmd")) {
    return null;
  }

  try {
    const content = fs.readFileSync(binary, "utf8");
    const match = content.match(/(?:node|node\.exe)"?\s+"?([^"\r\n]+\.js)"?/i);
    if (match?.[1] === undefined) {
      return null;
    }
    return path.resolve(path.dirname(binary), match[1]);
  } catch {
    return null;
  }
}
