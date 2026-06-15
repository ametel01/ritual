import { spawn } from "node:child_process";

const CLIPBOARD_COMMANDS = [
  { binary: "pbcopy", args: [] },
  { binary: "wl-copy", args: [] },
  { binary: "xclip", args: ["-selection", "clipboard"] },
  { binary: "xsel", args: ["--clipboard", "--input"] },
  { binary: "clip", args: [] },
] as const;

export type ClipboardRunner = {
  which(command: string): Promise<string | undefined>;
  runWithInput(command: string, args: ReadonlyArray<string>, input: string): Promise<void>;
};

export type PromptPrinter = {
  write(message: string): void;
};

export const nodeClipboardRunner: ClipboardRunner = {
  async which(command: string): Promise<string | undefined> {
    const { nodeCommandRunner } = await import("../system/exec.js");
    return nodeCommandRunner.which(command);
  },
  async runWithInput(command: string, args: ReadonlyArray<string>, input: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [...args], { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with ${code ?? 0}`));
        }
      });
      child.stdin.end(input);
    });
  },
};

export async function copyPromptToClipboard(
  prompt: string,
  runner: ClipboardRunner = nodeClipboardRunner,
  output: PromptPrinter = { write: (message) => console.error(message) },
): Promise<boolean> {
  for (const command of CLIPBOARD_COMMANDS) {
    if ((await runner.which(command.binary)) === undefined) {
      continue;
    }
    try {
      await runner.runWithInput(command.binary, command.args, prompt);
      return true;
    } catch {}
  }

  printPromptFallback(prompt, output);
  return false;
}

export function printPromptFallback(prompt: string, output: PromptPrinter): void {
  output.write("Could not copy or launch automatically. Use this prompt manually:");
  output.write("----- BEGIN REACT DOCTOR PROMPT -----");
  output.write(prompt);
  output.write("----- END REACT DOCTOR PROMPT -----");
}
