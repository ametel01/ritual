import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandInvocation = {
  command: string;
  args: string[];
};

export type CommandRunner = {
  which(command: string): Promise<string | undefined>;
  run(invocation: CommandInvocation): Promise<CommandResult>;
};

export type CommandLauncher = {
  launch(invocation: CommandInvocation, options: { cwd: string }): Promise<number>;
};

export const nodeCommandRunner: CommandRunner = {
  async which(command: string): Promise<string | undefined> {
    try {
      const result = await execFileAsync("sh", ["-c", 'command -v "$1"', "sh", command]);
      const resolved = result.stdout.trim();
      return resolved.length === 0 ? undefined : resolved;
    } catch {
      return undefined;
    }
  },
  async run(invocation: CommandInvocation): Promise<CommandResult> {
    const result = await execFileAsync(invocation.command, invocation.args, {
      maxBuffer: 1024 * 1024 * 10,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  },
};

export const nodeCommandLauncher: CommandLauncher = {
  launch(invocation: CommandInvocation, options: { cwd: string }): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: options.cwd,
        stdio: "inherit",
      });
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 0));
    });
  },
};
