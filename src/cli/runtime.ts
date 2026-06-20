import { realpathSync } from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { runInteractiveSession, type SessionResult } from "./interactive.js";
import { type PromptDumpOptions, type PromptDumpResult, runPromptDump } from "./prompt-dump.js";
import { isPromptCancelledError } from "./prompts.js";

const DEFAULT_PROMPT_DUMP_LIMIT = 100;
let gracefulExitHandlersInstalled = false;
const guardedStdin = new WeakSet<RuntimeStdin>();

export type CliOutput = {
  stdout(message: string): void;
  stderr(message: string): void;
};

export type RuntimeStdin = {
  on(event: "error", listener: (error: unknown) => void): RuntimeStdin;
  unref?: () => void;
};

export type RunCliOptions = {
  readonly argv?: string[];
  readonly stdin?: RuntimeStdin | undefined;
  readonly output?: CliOutput;
  readonly setExitCode?: (code: number) => void;
  readonly runInteractive?: () => Promise<SessionResult>;
  readonly runPromptDump?: (options: PromptDumpOptions) => Promise<PromptDumpResult>;
};

export async function runCli(options: RunCliOptions = {}): Promise<void> {
  installGracefulExitHandlers();
  const stdin = options.stdin ?? process.stdin;
  guardStdin(stdin);

  const argv = options.argv ?? process.argv;
  const args = normalizeHelpInvocation(argv.slice(2));
  const output = options.output ?? {
    stdout: (message: string) => console.log(message),
    stderr: (message: string) => console.error(message),
  };
  const setExitCode =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });
  const command = parseCliCommand(args);

  if (command.kind === "error") {
    output.stderr(command.message);
    setExitCode(1);
    unrefStdin(stdin);
    return;
  }

  try {
    if (command.kind === "help") {
      output.stdout(formatHelp());
      return;
    }
    if (command.kind === "prompts") {
      await (options.runPromptDump ?? runPromptDump)({
        cwd: process.cwd(),
        homeDir: os.homedir(),
        env: process.env,
        limit: command.limit,
        output: { write: output.stdout },
        diagnosticsOutput: { write: output.stderr },
      });
    } else {
      const result = await (options.runInteractive ?? runInteractiveSession)();
      if (result.status === "cancelled") {
        output.stdout(`Ritual stopped: ${result.reason}`);
      }
    }
  } catch (error) {
    handleTopLevelError(error, output, setExitCode);
  } finally {
    unrefStdin(stdin);
  }
}

export function normalizeHelpInvocation(args: readonly string[]): string[] {
  return args.map((arg) => (arg === "help" ? "--help" : arg));
}

type CliCommand =
  | { kind: "interactive" }
  | { kind: "prompts"; limit: number }
  | { kind: "help" }
  | { kind: "error"; message: string };

function parseCliCommand(args: readonly string[]): CliCommand {
  if (args.length === 0) {
    return { kind: "interactive" };
  }
  if (args[0] === "--help" || args[0] === "-h") {
    return { kind: "help" };
  }
  if (args[0] !== "prompts" && args[0] !== "--prompts") {
    return { kind: "error", message: "Usage: ritual [prompts|--prompts [--limit N]]" };
  }

  let limit = DEFAULT_PROMPT_DUMP_LIMIT;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== "--limit" && arg !== "-n") {
      return { kind: "error", message: "Usage: ritual prompts [--limit N]" };
    }

    const value = args[index + 1];
    if (value === undefined) {
      return { kind: "error", message: "Usage: ritual prompts [--limit N]" };
    }
    const parsedLimit = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || `${parsedLimit}` !== value) {
      return { kind: "error", message: "Prompt dump limit must be a positive integer." };
    }
    limit = parsedLimit;
    index += 1;
  }

  return { kind: "prompts", limit };
}

export function formatHelp(): string {
  return [
    "Usage: ritual [prompts|--prompts [--limit N]]",
    "ritual",
    "ritual prompts --limit 25",
    "",
    "Run `ritual` to start interactive skill-generation flow.",
  ].join("\n");
}

export function isDirectEntrypoint(importMetaUrl: string, argv = process.argv): boolean {
  const entrypoint = argv[1];
  return (
    entrypoint !== undefined &&
    resolveEntrypointPath(fileURLToPath(importMetaUrl)) === resolveEntrypointPath(entrypoint)
  );
}

function installGracefulExitHandlers(): void {
  if (gracefulExitHandlersInstalled) {
    return;
  }
  gracefulExitHandlersInstalled = true;
  process.once("SIGINT", () => {
    process.exitCode = 130;
  });
  process.once("SIGTERM", () => {
    process.exitCode = 143;
  });
}

function resolveEntrypointPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function unrefStdin(stdin: RuntimeStdin): void {
  stdin.unref?.();
}

function guardStdin(stdin: RuntimeStdin): void {
  if (guardedStdin.has(stdin)) {
    return;
  }
  guardedStdin.add(stdin);
  stdin.on("error", (error) => {
    if (isNodeError(error) && error.code === "EIO") {
      return;
    }
    throw error;
  });
}

function handleTopLevelError(
  error: unknown,
  output: CliOutput,
  setExitCode: (code: number) => void,
): void {
  const message = error instanceof Error ? error.message : "Unknown error.";
  if (isPromptCancelledError(error)) {
    output.stdout("Ritual stopped: Cancelled.");
    return;
  }
  output.stderr(`Ritual failed: ${message}`);
  setExitCode(1);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
