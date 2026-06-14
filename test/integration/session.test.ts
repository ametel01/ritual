import { mkdtemp, readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runInteractiveSession } from "../../src/cli/interactive.js";
import type { PromptAdapter } from "../../src/cli/prompts.js";
import type { CommandInvocation, CommandResult, CommandRunner } from "../../src/system/exec.js";
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
  invocations: CommandInvocation[] = [];

  async which(command: string): Promise<string | undefined> {
    return command === "claude" ? "/usr/local/bin/claude" : undefined;
  }

  async run(invocation: CommandInvocation): Promise<CommandResult> {
    this.invocations.push(invocation);
    return {
      stdout: [
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
      stderr: "",
    };
  }
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
    const outputs: string[] = [];
    const prompts = new QueuePrompts({
      confirms: [true, true, true, true],
      inputs: [fixturePath, "pr-review-workflow"],
      selects: ["codex", "candidate-1", "approve", "project"],
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
    });

    expect(result.status).toBe("completed");
    expect(runner.invocations).toHaveLength(1);
    expect(runner.invocations[0]?.command).toBe("claude");

    const claudePath = path.join(cwd, ".claude", "skills", "pr-review-workflow", "SKILL.md");
    const codexPath = path.join(cwd, ".agents", "skills", "pr-review-workflow", "SKILL.md");
    await expect(readFile(claudePath, "utf8")).resolves.toContain("name: pr-review-workflow");
    await expect(readFile(codexPath, "utf8")).resolves.toContain("name: pr-review-workflow");
    expect(outputs.some((line) => line.includes("user prompts extracted"))).toBe(true);
  });
});
