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

  return {
    sources: sourceResults,
    prompts: sourceResults.flatMap((result) => result.prompts),
    diagnostics,
  };
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
