import { access, readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { parseClaudeHistoryFile } from "./parse-claude.js";
import { parseCodexHistoryFile } from "./parse-codex.js";
import type {
  Diagnostic,
  HistoryDiscoveryOptions,
  HistoryScanResult,
  HistorySource,
  SourceScanResult,
} from "./types.js";

const HISTORY_EXTENSIONS = new Set([".json", ".jsonl"]);
const DUPLICATE_PROMPT_WINDOW_MS = 60_000;

export async function discoverHistorySources(options: HistoryDiscoveryOptions): Promise<{
  sources: HistorySource[];
  diagnostics: Diagnostic[];
}> {
  const diagnostics: Diagnostic[] = [];
  const claudeConfigDir = options.env?.CLAUDE_CONFIG_DIR ?? path.join(options.homeDir, ".claude");
  const codexHome = options.env?.CODEX_HOME ?? path.join(options.homeDir, ".codex");
  const candidates: HistorySource[] = [
    { kind: "claude", path: path.join(claudeConfigDir, "history.jsonl") },
    { kind: "claude", path: path.join(claudeConfigDir, "projects") },
    { kind: "codex", path: path.join(codexHome, "history.jsonl") },
    { kind: "codex", path: path.join(codexHome, "sessions") },
    { kind: "codex", path: path.join(codexHome, "archived_sessions") },
    ...(options.extraSources ?? []),
  ];

  const sources: HistorySource[] = [];
  for (const candidate of candidates) {
    if (!(await exists(candidate.path))) {
      diagnostics.push({
        level: "info",
        message: `${candidate.kind} history path was not found.`,
        sourcePath: candidate.path,
      });
      continue;
    }
    const files = await discoverFiles(candidate.path);
    if (files.length === 0) {
      diagnostics.push({
        level: "warning",
        message: `${candidate.kind} history path contains no supported JSON or JSONL files.`,
        sourcePath: candidate.path,
      });
      continue;
    }
    sources.push(...files.map((filePath) => ({ kind: candidate.kind, path: filePath })));
  }

  const deduped = new Map<string, HistorySource>();
  for (const source of sources) {
    deduped.set(`${source.kind}:${source.path}`, source);
  }

  return { sources: [...deduped.values()], diagnostics };
}

export async function scanHistorySources(sources: HistorySource[]): Promise<HistoryScanResult> {
  const sourceResults: SourceScanResult[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const source of sources) {
    try {
      const content = await readFile(source.path, "utf8");
      const parsed =
        source.kind === "claude"
          ? parseClaudeHistoryFile(source.path, content)
          : parseCodexHistoryFile(source.path, content);
      sourceResults.push({ source, prompts: parsed.prompts, diagnostics: parsed.diagnostics });
      diagnostics.push(...parsed.diagnostics);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown read error.";
      const diagnostic = {
        level: "error" as const,
        message: `Failed to read history source: ${message}`,
        sourcePath: source.path,
      };
      sourceResults.push({ source, prompts: [], diagnostics: [diagnostic] });
      diagnostics.push(diagnostic);
    }
  }

  const dedupedSourceResults = dedupeSourcePrompts(sourceResults);

  return {
    sources: dedupedSourceResults,
    prompts: dedupedSourceResults.flatMap((result) => result.prompts),
    diagnostics,
  };
}

function dedupeSourcePrompts(sourceResults: SourceScanResult[]): SourceScanResult[] {
  const keptPromptIds = new Set(
    dedupePrompts(sourceResults.flatMap((result) => result.prompts)).map((prompt) => prompt.id),
  );

  return sourceResults.map((result) => ({
    ...result,
    prompts: result.prompts.filter((prompt) => keptPromptIds.has(prompt.id)),
  }));
}

function dedupePrompts(prompts: SourceScanResult["prompts"]): SourceScanResult["prompts"] {
  const groups = new Map<string, SourceScanResult["prompts"]>();
  for (const prompt of prompts) {
    const key = `${prompt.source}:${normalizePromptText(prompt.text)}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [prompt]);
    } else {
      group.push(prompt);
    }
  }

  const keptIds = new Set<string>();
  for (const group of groups.values()) {
    const kept = dedupePromptGroup(group);
    for (const prompt of kept) {
      keptIds.add(prompt.id);
    }
  }

  return prompts.filter((prompt) => keptIds.has(prompt.id));
}

function dedupePromptGroup(prompts: SourceScanResult["prompts"]): SourceScanResult["prompts"] {
  const sorted = [...prompts].sort((left, right) => promptTimestamp(right) - promptTimestamp(left));
  const kept: SourceScanResult["prompts"] = [];

  for (const prompt of sorted) {
    if (kept.some((existing) => isDuplicatePrompt(prompt, existing))) {
      continue;
    }
    kept.push(prompt);
  }

  return kept;
}

function isDuplicatePrompt(
  prompt: SourceScanResult["prompts"][number],
  existing: SourceScanResult["prompts"][number],
): boolean {
  const promptTimestampValue = promptTimestamp(prompt);
  const existingTimestampValue = promptTimestamp(existing);
  if (
    promptTimestampValue === Number.NEGATIVE_INFINITY ||
    existingTimestampValue === Number.NEGATIVE_INFINITY
  ) {
    return promptTimestampValue === existingTimestampValue;
  }
  return Math.abs(promptTimestampValue - existingTimestampValue) <= DUPLICATE_PROMPT_WINDOW_MS;
}

function promptTimestamp(prompt: SourceScanResult["prompts"][number]): number {
  if (prompt.createdAt === undefined) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = Date.parse(prompt.createdAt);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function normalizePromptText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

async function discoverFiles(rootPath: string): Promise<string[]> {
  const rootStat = await stat(rootPath);
  if (rootStat.isFile()) {
    return HISTORY_EXTENSIONS.has(path.extname(rootPath)) ? [rootPath] : [];
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return discoverFiles(entryPath);
      }
      if (entry.isFile() && HISTORY_EXTENSIONS.has(path.extname(entry.name))) {
        return [entryPath];
      }
      return [];
    }),
  );
  return nested.flat().sort();
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
