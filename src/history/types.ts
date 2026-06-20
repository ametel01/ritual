export type HistorySourceKind = "claude" | "codex";

export type DiagnosticLevel = "info" | "warning" | "error";

export type Diagnostic = {
  level: DiagnosticLevel;
  message: string;
  sourcePath?: string;
};

export type HistorySource = {
  kind: HistorySourceKind;
  path: string;
};

export type ExtractedPrompt = {
  id: string;
  source: HistorySourceKind;
  sourcePath: string;
  sessionId?: string;
  createdAt?: string;
  text: string;
};

export type SourceScanResult = {
  source: HistorySource;
  prompts: ExtractedPrompt[];
  diagnostics: Diagnostic[];
};

export type HistoryScanResult = {
  sources: SourceScanResult[];
  prompts: ExtractedPrompt[];
  diagnostics: Diagnostic[];
};

export type HistoryDiscoveryEnvironment = Record<string, string | undefined> & {
  CLAUDE_CONFIG_DIR?: string;
  CODEX_HOME?: string;
};

export type HistoryDiscoveryOptions = {
  cwd: string;
  homeDir: string;
  env?: HistoryDiscoveryEnvironment;
  extraSources?: HistorySource[];
  maxFilesPerRoot?: number;
};

export type HistoryScanOptions = {
  maxFileBytes?: number;
};
