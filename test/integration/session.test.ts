import { mkdtemp, readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runInteractiveSession } from "../../src/cli/interactive.js";
import type { PromptAdapter } from "../../src/cli/prompts.js";
import type {
  CommandInvocation,
  CommandLauncher,
  CommandResult,
  CommandRunner,
} from "../../src/system/exec.js";
import { nodeFileSystem } from "../../src/system/filesystem.js";

class QueuePrompts implements PromptAdapter {
  readonly confirms: boolean[];
  readonly inputs: string[];
  readonly selects: string[];
  readonly checkboxes: string[][];

  constructor(options: {
    confirms: boolean[];
    inputs: string[];
    selects: string[];
    checkboxes: string[][];
  }) {
    this.confirms = [...options.confirms];
    this.inputs = [...options.inputs];
    this.selects = [...options.selects];
    this.checkboxes = [...options.checkboxes];
  }

  async confirm(): Promise<boolean> {
    const value = this.confirms.shift();
    if (value === undefined) {
      throw new Error("Missing confirm answer.");
    }
    return value;
  }

  async input(): Promise<string> {
    const value = this.inputs.shift();
    if (value === undefined) {
      throw new Error("Missing input answer.");
    }
    return value;
  }

  async select<Value extends string>(): Promise<Value> {
    const value = this.selects.shift();
    if (value === undefined) {
      throw new Error("Missing select answer.");
    }
    return value as Value;
  }

  async checkbox<Value extends string>(): Promise<Value[]> {
    const value = this.checkboxes.shift();
    if (value === undefined) {
      throw new Error("Missing checkbox answer.");
    }
    return value as Value[];
  }
}

class MockRunner implements CommandRunner {
  async which(command: string): Promise<string | undefined> {
    return command === "claude" ? "/usr/local/bin/claude" : undefined;
  }

  async run(_invocation: CommandInvocation): Promise<CommandResult> {
    throw new Error("not used");
  }
}

class MockLauncher implements CommandLauncher {
  invocations: Array<{ invocation: CommandInvocation; cwd: string }> = [];

  constructor(private readonly skillPath: string) {}

  async launch(invocation: CommandInvocation, options: { cwd: string }): Promise<number> {
    this.invocations.push({ invocation, cwd: options.cwd });
    const prompt = invocation.args.at(-1) ?? "";
    const reportPath = discoveryReportPath(prompt);
    if (reportPath !== undefined) {
      await nodeFileSystem.writeTextAtomic(
        reportPath,
        JSON.stringify({
          candidates: [
            {
              name: "pr-review-workflow",
              summary: "Review TypeScript pull requests for correctness and test coverage.",
              rationale:
                "Multiple recorded sessions ask for the same pull request review workflow.",
              confidence: "high",
              scope: "project",
              representativePrompts: [
                "Review this TypeScript PR for correctness bugs and missing Vitest tests.",
                "Please review this TypeScript pull request for bugs and missing tests.",
                "Review this TypeScript PR for CI risks, bugs, and missing coverage.",
              ],
              sourcePaths: [path.join(options.cwd, "history.jsonl")],
              repeatCount: 3,
            },
          ],
        }),
      );
      return 0;
    }

    await nodeFileSystem.writeTextAtomic(
      this.skillPath,
      [
        "---",
        "name: pr-review-workflow",
        "description: Use when reviewing TypeScript pull requests for correctness, CI risk, and test coverage.",
        "---",
        "",
        "## Workflow",
        "",
        "- Inspect the changed files and identify behavior changes.",
        "- Check package scripts, tests, and CI expectations.",
        "- Report findings with file references and concrete fixes.",
      ].join("\n"),
    );
    return 0;
  }
}

function discoveryReportPath(prompt: string): string | undefined {
  const match = /Report path:\n(.+)\n\nTask:/u.exec(prompt);
  return match?.[1];
}

describe("interactive session", () => {
  it("runs the happy path without touching real history or skill roots", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-session-cwd-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "ritual-session-home-"));
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "fixtures",
      "history",
      "codex-repeat.jsonl",
    );
    const runner = new MockRunner();
    const claudePath = path.join(cwd, ".claude", "skills", "pr-review-workflow", "SKILL.md");
    const launcher = new MockLauncher(claudePath);
    const outputs: string[] = [];
    const prompts = new QueuePrompts({
      confirms: [true, true],
      inputs: [fixturePath, "pr-review-workflow"],
      selects: ["codex", "claude", "agent-candidate-1", "project", "claude"],
      checkboxes: [["claude", "codex"]],
    });

    const result = await runInteractiveSession({
      cwd,
      homeDir,
      env: {},
      prompts,
      output: { write: (message) => outputs.push(message) },
      fs: nodeFileSystem,
      runner,
      launcher,
    });

    expect(result.status).toBe("completed");
    expect(launcher.invocations).toHaveLength(2);
    expect(launcher.invocations[0]?.invocation.command).toBe("claude");
    expect(launcher.invocations[0]?.invocation.args[0]).toBe("--dangerously-skip-permissions");
    expect(launcher.invocations[0]?.invocation.args.at(-1)).toContain(
      "Analyze local recorded Claude and Codex sessions",
    );
    expect(launcher.invocations[1]?.invocation.args.at(-1)).toContain(
      "Create exactly one reusable agent skill and write it directly to this file:",
    );
    expect(launcher.invocations[0]?.cwd).toBe(cwd);
    expect(launcher.invocations[1]?.cwd).toBe(cwd);

    const codexPath = path.join(cwd, ".agents", "skills", "pr-review-workflow", "SKILL.md");
    await expect(readFile(claudePath, "utf8")).resolves.toContain("name: pr-review-workflow");
    await expect(readFile(codexPath, "utf8")).resolves.toContain("name: pr-review-workflow");
    expect(outputs.some((line) => line.includes("found 3 user prompts"))).toBe(true);
    expect(outputs.some((line) => line.includes("Agent found 1 skill candidate"))).toBe(true);
    expect(outputs.some((line) => line.includes("Representative workflow examples"))).toBe(true);
    expect(outputs.some((line) => line.toLowerCase().includes("draft"))).toBe(false);
  });

  it("skips repeated workflows already covered by existing skills", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "ritual-session-cwd-"));
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "ritual-session-home-"));
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "fixtures",
      "history",
      "codex-repeat.jsonl",
    );
    await nodeFileSystem.writeTextAtomic(
      path.join(cwd, ".claude", "skills", "review-this-typescript-missing", "SKILL.md"),
      [
        "---",
        "name: review-this-typescript-missing",
        "description: Use when reviewing TypeScript pull requests for correctness and test coverage.",
        "---",
        "",
        "Inspect changed files, check tests, and report concrete pull request findings.",
      ].join("\n"),
    );

    const runner = new MockRunner();
    const launcher = new MockLauncher(path.join(cwd, "unused", "SKILL.md"));
    const outputs: string[] = [];
    const prompts = new QueuePrompts({
      confirms: [true, false],
      inputs: [fixturePath],
      selects: ["codex"],
      checkboxes: [],
    });

    const result = await runInteractiveSession({
      cwd,
      homeDir,
      env: {},
      prompts,
      output: { write: (message) => outputs.push(message) },
      fs: nodeFileSystem,
      runner,
      launcher,
    });

    expect(result).toEqual({ status: "cancelled", reason: "No candidate was approved." });
    expect(launcher.invocations).toEqual([]);
    expect(outputs).toContain("Skipped 1 repeated workflow already covered by existing skills.");
  });
});
