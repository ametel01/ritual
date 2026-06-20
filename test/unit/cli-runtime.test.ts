import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { SessionResult } from "../../src/cli/interactive.js";
import type { PromptDumpOptions, PromptDumpResult } from "../../src/cli/prompt-dump.js";
import { PromptCancelledError } from "../../src/cli/prompts.js";
import {
  isDirectEntrypoint,
  normalizeHelpInvocation,
  type RuntimeStdin,
  runCli,
} from "../../src/cli/runtime.js";

class FakeStdin extends EventEmitter implements RuntimeStdin {
  unrefCalls = 0;

  unref(): this {
    this.unrefCalls += 1;
    return this;
  }
}

describe("cli runtime", () => {
  it("normalizes bare help before argument handling", () => {
    expect(normalizeHelpInvocation(["help"])).toEqual(["--help"]);
  });

  it("detects direct execution through package bin symlinks", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "ritual-bin-"));
    const realEntrypoint = path.join(tempDir, "dist", "cli", "main.js");
    const binEntrypoint = path.join(tempDir, "node_modules", ".bin", "ritualai");
    await mkdir(path.dirname(realEntrypoint), { recursive: true });
    await mkdir(path.dirname(binEntrypoint), { recursive: true });
    await writeFile(realEntrypoint, "", "utf8");
    await symlink(realEntrypoint, binEntrypoint);

    expect(isDirectEntrypoint(pathToFileURL(realEntrypoint).href, ["node", binEntrypoint])).toBe(
      true,
    );
  });

  it("rejects unknown subcommands and flags", async () => {
    const stderr: string[] = [];
    const exitCodes: number[] = [];
    const stdin = new FakeStdin();

    await runCli({
      argv: ["node", "ritual", "--json"],
      stdin,
      output: { stdout: () => undefined, stderr: (message) => stderr.push(message) },
      setExitCode: (code) => exitCodes.push(code),
      async runInteractive(): Promise<SessionResult> {
        throw new Error("interactive session should not run");
      },
    });

    expect(stdin.unrefCalls).toBe(1);
    expect(stderr).toEqual(["Usage: ritual [prompts|--prompts [--limit N]]"]);
    expect(exitCodes).toEqual([1]);
  });

  it("runs the prompt dump command with the default limit", async () => {
    const stdin = new FakeStdin();
    const dumpOptions: PromptDumpOptions[] = [];

    await runCli({
      argv: ["node", "ritual", "prompts"],
      stdin,
      output: { stdout: () => undefined, stderr: () => undefined },
      setExitCode: () => undefined,
      async runInteractive(): Promise<SessionResult> {
        throw new Error("interactive session should not run");
      },
      async runPromptDump(options): Promise<PromptDumpResult> {
        dumpOptions.push(options);
        return { status: "completed", count: 0 };
      },
    });

    expect(dumpOptions).toHaveLength(1);
    expect(dumpOptions[0]?.limit).toBe(100);
    expect(stdin.unrefCalls).toBe(1);
  });

  it("runs the prompt dump command with an explicit limit", async () => {
    const dumpOptions: PromptDumpOptions[] = [];

    await runCli({
      argv: ["node", "ritual", "prompts", "--limit", "12"],
      stdin: new FakeStdin(),
      output: { stdout: () => undefined, stderr: () => undefined },
      setExitCode: () => undefined,
      async runPromptDump(options): Promise<PromptDumpResult> {
        dumpOptions.push(options);
        return { status: "completed", count: 0 };
      },
    });

    expect(dumpOptions[0]?.limit).toBe(12);
  });

  it("runs the prompt dump command through the --prompts alias", async () => {
    const dumpOptions: PromptDumpOptions[] = [];

    await runCli({
      argv: ["node", "ritual", "--prompts", "--limit", "50"],
      stdin: new FakeStdin(),
      output: { stdout: () => undefined, stderr: () => undefined },
      setExitCode: () => undefined,
      async runPromptDump(options): Promise<PromptDumpResult> {
        dumpOptions.push(options);
        return { status: "completed", count: 0 };
      },
    });

    expect(dumpOptions[0]?.limit).toBe(50);
  });

  it("rejects invalid prompt dump limits", async () => {
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    await runCli({
      argv: ["node", "ritual", "prompts", "--limit", "0"],
      stdin: new FakeStdin(),
      output: { stdout: () => undefined, stderr: (message) => stderr.push(message) },
      setExitCode: (code) => exitCodes.push(code),
      async runPromptDump(): Promise<PromptDumpResult> {
        throw new Error("prompt dump should not run");
      },
    });

    expect(stderr).toEqual(["Prompt dump limit must be a positive integer."]);
    expect(exitCodes).toEqual([1]);
  });

  it("runs the interactive session when no args are supplied", async () => {
    const stdout: string[] = [];
    const stdin = new FakeStdin();

    await runCli({
      argv: ["node", "ritual"],
      stdin,
      output: { stdout: (message) => stdout.push(message), stderr: () => undefined },
      setExitCode: () => undefined,
      async runInteractive(): Promise<SessionResult> {
        expect(stdin.unrefCalls).toBe(0);
        return { status: "cancelled", reason: "done" };
      },
    });

    expect(stdout).toEqual(["Ritual stopped: done"]);
    expect(stdin.unrefCalls).toBe(1);
  });

  it("funnels unexpected top-level errors through a stable Ritual message", async () => {
    const stderr: string[] = [];
    const exitCodes: number[] = [];

    await runCli({
      argv: ["node", "ritual"],
      stdin: new FakeStdin(),
      output: { stdout: () => undefined, stderr: (message) => stderr.push(message) },
      setExitCode: (code) => exitCodes.push(code),
      async runInteractive(): Promise<SessionResult> {
        throw new Error("boom");
      },
    });

    expect(stderr).toEqual(["Ritual failed: boom"]);
    expect(exitCodes).toEqual([1]);
  });

  it("treats terminal prompt cancellation as a clean stop", async () => {
    const stdout: string[] = [];
    const exitCodes: number[] = [];

    await runCli({
      argv: ["node", "ritual"],
      stdin: new FakeStdin(),
      output: { stdout: (message) => stdout.push(message), stderr: () => undefined },
      setExitCode: (code) => exitCodes.push(code),
      async runInteractive(): Promise<SessionResult> {
        throw new PromptCancelledError();
      },
    });

    expect(stdout).toEqual(["Ritual stopped: Cancelled."]);
    expect(exitCodes).toEqual([]);
  });
});
