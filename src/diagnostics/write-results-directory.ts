import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { buildSortedRuleGroups } from "./grouping.js";
import type { Diagnostic } from "./types.js";

const DIAGNOSTICS_FILE_NAME = "diagnostics.json";

function ruleDumpFileName(ruleKey: string): string {
  return `${ruleKey.replace(/\//g, "--")}.txt`;
}

function readPreviousRuleDumpFileNames(directory: string): string[] {
  try {
    const raw = fs.readFileSync(path.join(directory, DIAGNOSTICS_FILE_NAME), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const previousDiagnostics = parsed.filter(isDiagnosticLike);
    return buildSortedRuleGroups(previousDiagnostics).map(([ruleKey]) => ruleDumpFileName(ruleKey));
  } catch {
    return [];
  }
}

function isDiagnosticLike(value: unknown): value is Diagnostic {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Diagnostic, unknown>>;
  return typeof candidate.plugin === "string" && typeof candidate.rule === "string";
}

function formatRuleSummary(ruleKey: string, diagnostics: Diagnostic[]): string {
  const lines = [`${ruleKey} (${diagnostics.length})`, ""];
  for (const diagnostic of diagnostics) {
    const location =
      diagnostic.line > 0 ? `${diagnostic.filePath}:${diagnostic.line}` : diagnostic.filePath;
    lines.push(
      `${diagnostic.severity.toUpperCase()} ${location}`,
      diagnostic.title ?? diagnostic.message,
      diagnostic.help,
      "",
    );
  }
  return lines.join("\n").trimEnd();
}

export function writeDiagnosticsDirectory(
  diagnostics: Diagnostic[],
  outputDirectory?: string | null,
): string {
  const directory =
    outputDirectory === undefined || outputDirectory === null
      ? path.join(tmpdir(), `react-doctor-${randomUUID()}`)
      : path.resolve(outputDirectory);

  if (outputDirectory !== undefined && outputDirectory !== null) {
    for (const fileName of readPreviousRuleDumpFileNames(directory)) {
      fs.rmSync(path.join(directory, fileName), { force: true });
    }
  }

  fs.mkdirSync(directory, { recursive: true });

  for (const [ruleKey, ruleDiagnostics] of buildSortedRuleGroups(diagnostics)) {
    fs.writeFileSync(
      path.join(directory, ruleDumpFileName(ruleKey)),
      formatRuleSummary(ruleKey, ruleDiagnostics),
      "utf8",
    );
  }

  fs.writeFileSync(
    path.join(directory, DIAGNOSTICS_FILE_NAME),
    JSON.stringify(diagnostics),
    "utf8",
  );
  return directory;
}
