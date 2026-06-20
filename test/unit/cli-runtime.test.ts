import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { SessionResult } from "../../src/cli/interactive.js";
import type { PromptDumpOptions, PromptDumpResult } from "../../src/cli/prompt-dump.js";
import { PromptCancelledError } from "../../src/cli/prompts.js";
import {
  formatHelp,
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

  it("prints help for --help and exits successfully without running other commands", async () => {
    const stdout: string[] = [];
    const exitCodes: number[] = [];
    const called: string[] = [];
    const stdin = new FakeStdin();

    await runCli({
      argv: ["node", "ritual", "--help"],
      stdin,
      output: { stdout: (message) => stdout.push(message), stderr: () => undefined },
      setExitCode: (code) => exitCodes.push(code),
      async runInteractive(): Promise<SessionResult> {
        called.push("interactive");
        throw new Error("interactive session should not run");
      },
      async runPromptDump(): Promise<PromptDumpResult> {
        called.push("prompt-dump");
        throw new Error("prompt dump should not run");
      },
    });

    expect(stdout).toContain(formatHelp());
    expect(called).toEqual([]);
    expect(exitCodes).toEqual([]);
    expect(stdin.unrefCalls).toBe(1);
  });

  it("prints help for normalized bare help", async () => {
    const stdout: string[] = [];
    await runCli({
      argv: ["node", "ritual", "help"],
      stdin: new FakeStdin(),
      output: { stdout: (message) => stdout.push(message), stderr: () => undefined },
      setExitCode: () => undefined,
      async runInteractive(): Promise<SessionResult> {
        throw new Error("interactive session should not run");
      },
      async runPromptDump(): Promise<PromptDumpResult> {
        throw new Error("prompt dump should not run");
      },
    });

    expect(stdout).toContain(formatHelp());
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
    expect(dumpOptions[0]?.diagnosticsOutput).toBeDefined();
    expect(stdin.unrefCalls).toBe(1);
  });

  it("passes a separate diagnostics output when running prompts", async () => {
    const stdin = new FakeStdin();
    const diagnosticSink: string[] = [];
    const promptSink: string[] = [];

    await runCli({
      argv: ["node", "ritual", "prompts", "--limit", "3"],
      stdin,
      output: {
        stdout: (message) => promptSink.push(message),
        stderr: (message) => diagnosticSink.push(message),
      },
      setExitCode: () => undefined,
      async runPromptDump(options): Promise<PromptDumpResult> {
        options.output?.write("prompt output");
        options.diagnosticsOutput?.write("diagnostic output");
        return { status: "completed", count: 1 };
      },
    });

    expect(promptSink).toContain("prompt output");
    expect(diagnosticSink).toContain("diagnostic output");
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

  it("installs SIGINT/SIGTERM handlers only once across repeated runCli calls", async () => {
    const baselineSigint = process.listenerCount("SIGINT");
    const baselineSigterm = process.listenerCount("SIGTERM");
    const stdin = new FakeStdin();

    await runCli({
      argv: ["node", "ritual"],
      stdin,
      output: { stdout: () => undefined, stderr: () => undefined },
      setExitCode: () => undefined,
      async runInteractive(): Promise<SessionResult> {
        return { status: "cancelled", reason: "done" };
      },
    });
    await runCli({
      argv: ["node", "ritual"],
      stdin: new FakeStdin(),
      output: { stdout: () => undefined, stderr: () => undefined },
      setExitCode: () => undefined,
      async runInteractive(): Promise<SessionResult> {
        return { status: "cancelled", reason: "done" };
      },
    });

    const increasedSigint = process.listenerCount("SIGINT") - baselineSigint;
    const increasedSigterm = process.listenerCount("SIGTERM") - baselineSigterm;
    expect(increasedSigint).toBeLessThanOrEqual(1);
    expect(increasedSigterm).toBeLessThanOrEqual(1);
  });

  it("guards the shared stdin stream only once and still unrefs each run", async () => {
    const stdin = new FakeStdin();
    const baselineError = stdin.listenerCount("error");

    await runCli({
      argv: ["node", "ritual"],
      stdin,
      output: { stdout: () => undefined, stderr: () => undefined },
      setExitCode: () => undefined,
      async runInteractive(): Promise<SessionResult> {
        return { status: "cancelled", reason: "done" };
      },
    });
    await runCli({
      argv: ["node", "ritual"],
      stdin,
      output: { stdout: () => undefined, stderr: () => undefined },
      setExitCode: () => undefined,
      async runInteractive(): Promise<SessionResult> {
        return { status: "cancelled", reason: "done" };
      },
    });

    expect(stdin.listenerCount("error") - baselineError).toBeLessThanOrEqual(1);
    expect(stdin.unrefCalls).toBe(2);
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
