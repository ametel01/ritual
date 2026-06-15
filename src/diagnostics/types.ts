export type DiagnosticSeverity = "error" | "warning";

export type Diagnostic = {
  readonly filePath: string;
  readonly plugin: string;
  readonly rule: string;
  readonly severity: DiagnosticSeverity;
  readonly title?: string;
  readonly message: string;
  readonly help: string;
  readonly url?: string;
  readonly line: number;
  readonly column: number;
  readonly category: string;
  readonly fileContext?: "test" | "story";
  readonly suppressionHint?: string;
};
