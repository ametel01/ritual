import * as os from "node:os";
import { discoverHistorySources, scanHistorySources } from "../history/discover.js";
import type { ExtractedPrompt, HistoryDiscoveryEnvironment } from "../history/types.js";

const DEFAULT_LIMIT = 100;

export type PromptDumpOutput = {
  write(message: string): void;
};

export type PromptDumpOptions = {
  cwd?: string;
  homeDir?: string;
  env?: HistoryDiscoveryEnvironment;
  limit?: number;
  output?: PromptDumpOutput;
};

export type PromptDumpResult = {
  status: "completed";
  count: number;
};

export async function runPromptDump(options: PromptDumpOptions = {}): Promise<PromptDumpResult> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const output = options.output ?? { write: (message: string) => console.log(message) };

  const discovered = await discoverHistorySources({ cwd, homeDir, env });
  const scan = await scanHistorySources(discovered.sources);
  const prompts = latestPrompts(scan.prompts, limit);

  for (const prompt of prompts) {
    output.write(formatPromptLine(prompt));
  }

  return { status: "completed", count: prompts.length };
}

export function latestPrompts(
  prompts: ExtractedPrompt[],
  limit = DEFAULT_LIMIT,
): ExtractedPrompt[] {
  return prompts
    .map((prompt, index) => ({ prompt, index, timestamp: promptTimestamp(prompt) }))
    .sort((left, right) => right.timestamp - left.timestamp || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.prompt);
}

export function formatPromptLine(prompt: ExtractedPrompt): string {
  const createdAt = prompt.createdAt ?? "undated";
  const text = prompt.text.replace(/\s+/g, " ").trim();
  return `${createdAt}\t${prompt.source}\t${text}`;
}

function promptTimestamp(prompt: ExtractedPrompt): number {
  if (prompt.createdAt === undefined) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = Date.parse(prompt.createdAt);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}
