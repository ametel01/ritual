import type { Diagnostic, ExtractedPrompt, HistorySourceKind } from "./types.js";

type ParsedRecord = {
  value: unknown;
  line?: number;
};

type PromptCandidate = {
  text: string;
  sessionId?: string;
  createdAt?: string;
};

export type ParseResult = {
  prompts: ExtractedPrompt[];
  diagnostics: Diagnostic[];
};

export function parseRecords(
  content: string,
  sourcePath: string,
): {
  records: ParsedRecord[];
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return {
      records: [],
      diagnostics: [{ level: "warning", message: "History file is empty.", sourcePath }],
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return { records: parsed.map((value) => ({ value })), diagnostics };
    }
    return { records: [{ value: parsed }], diagnostics };
  } catch {
    const records: ParsedRecord[] = [];
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      const lineText = line.trim();
      if (lineText.length === 0) {
        continue;
      }
      try {
        records.push({ value: JSON.parse(lineText) as unknown, line: lineNumber });
      } catch {
        diagnostics.push({
          level: "warning",
          message: `Malformed JSON record at line ${lineNumber}.`,
          sourcePath,
        });
      }
    }
    if (records.length === 0) {
      diagnostics.push({
        level: "error",
        message: "No supported JSON or JSONL records found.",
        sourcePath,
      });
    }
    return { records, diagnostics };
  }
}

export function promptFromRecord(record: unknown): PromptCandidate | undefined {
  if (!isRecord(record) || !isUserRecord(record)) {
    const wrapper = isRecord(record) ? record : undefined;
    const payload = wrapper === undefined ? undefined : firstKnownValue(wrapper, ["payload"]);
    if (!isRecord(payload)) {
      return undefined;
    }
    const candidate = promptFromRecord(payload);
    if (candidate === undefined) {
      return undefined;
    }
    if (wrapper === undefined) {
      return candidate;
    }
    const sessionId =
      candidate.sessionId ??
      stringValue(firstKnownValue(wrapper, ["sessionId", "session_id", "conversation_id", "id"]));
    const createdAt =
      candidate.createdAt ??
      stringValue(firstKnownValue(wrapper, ["createdAt", "created_at", "timestamp", "time"]));

    return {
      text: candidate.text,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(createdAt === undefined ? {} : { createdAt }),
    };
  }

  if (!isRecord(record)) {
    return undefined;
  }

  const text = contentToText(
    firstKnownValue(record, ["content", "message", "prompt", "text", "input"]),
  );
  if (text === undefined || text.trim().length === 0) {
    return undefined;
  }

  const sessionId = stringValue(
    firstKnownValue(record, ["sessionId", "session_id", "conversation_id"]),
  );
  const createdAt = stringValue(
    firstKnownValue(record, ["createdAt", "created_at", "timestamp", "time"]),
  );

  return {
    text: text.trim(),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(createdAt === undefined ? {} : { createdAt }),
  };
}

export function toExtractedPrompts(params: {
  candidates: PromptCandidate[];
  source: HistorySourceKind;
  sourcePath: string;
  prefix: string;
}): ExtractedPrompt[] {
  return params.candidates
    .filter((candidate) => isReusablePromptText(candidate.text))
    .map((candidate, index) => ({
      id: `${params.prefix}:${index + 1}`,
      source: params.source,
      sourcePath: params.sourcePath,
      text: candidate.text,
      ...(candidate.sessionId === undefined ? {} : { sessionId: candidate.sessionId }),
      ...(candidate.createdAt === undefined ? {} : { createdAt: candidate.createdAt }),
    }));
}

function isUserRecord(record: Record<string, unknown>): boolean {
  const directRole = stringValue(firstKnownValue(record, ["role", "type", "kind", "author"]));
  if (directRole !== undefined && directRole.toLowerCase() === "user") {
    return true;
  }

  const message = firstKnownValue(record, ["message", "event"]);
  if (isRecord(message)) {
    const nestedRole = stringValue(firstKnownValue(message, ["role", "type", "kind", "author"]));
    return nestedRole !== undefined && nestedRole.toLowerCase() === "user";
  }

  return false;
}

function contentToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value)) {
    const role = stringValue(firstKnownValue(value, ["role", "type"]));
    if (role !== undefined && role.toLowerCase() !== "user" && role.toLowerCase() !== "text") {
      return undefined;
    }
    return contentToText(firstKnownValue(value, ["content", "text", "input"]));
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => contentPartToText(item))
      .filter((item): item is string => item !== undefined && item.trim().length > 0);
    if (parts.length === 0) {
      return undefined;
    }
    return parts.join("\n");
  }

  return undefined;
}

function contentPartToText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return isInjectedContextText(value) ? undefined : value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const type = stringValue(firstKnownValue(value, ["type"]));
  if (type !== undefined && !["text", "input_text", "user"].includes(type.toLowerCase())) {
    return undefined;
  }
  const text = stringValue(firstKnownValue(value, ["text", "content", "input"]));
  if (text === undefined || isInjectedContextText(text)) {
    return undefined;
  }
  return text;
}

function isInjectedContextText(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("<codex_internal_context") ||
    trimmed.startsWith("<environment_context") ||
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("<collaboration_mode>") ||
    trimmed.startsWith("<apps_instructions>") ||
    trimmed.startsWith("<skills_instructions>") ||
    trimmed.startsWith("<plugins_instructions>") ||
    trimmed.startsWith("<turn_aborted>") ||
    trimmed.startsWith("<subagent_notification>") ||
    trimmed.startsWith("# AGENTS.md instructions")
  );
}

function isReusablePromptText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.startsWith("/")) {
    return false;
  }
  if (isInjectedContextText(trimmed)) {
    return false;
  }
  if (isSkillCallText(trimmed)) {
    return false;
  }
  if (
    isLowSignalAcknowledgementText(trimmed) ||
    isStructuredPayloadText(trimmed) ||
    isTerminalTranscriptText(trimmed) ||
    isStandaloneAttachmentText(trimmed) ||
    isGeneratedHandoffText(trimmed) ||
    isLocalPageInspectionText(trimmed) ||
    isRenderedOutputDumpText(trimmed) ||
    isLogDumpText(trimmed) ||
    isRiskReportDumpText(trimmed) ||
    isCiLogDumpText(trimmed)
  ) {
    return false;
  }
  return !isLikelyAssistantResponseText(trimmed);
}

function isSkillCallText(text: string): boolean {
  if (text.includes("<skill>") && text.includes("</skill>")) {
    return true;
  }
  const skillNamePattern = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
  return (
    new RegExp(`(^|\\s)\\[\\$${skillNamePattern}\\]\\([^)]+\\)`).test(text) ||
    new RegExp(`(^|\\s)\\$${skillNamePattern}\\b`).test(text)
  );
}

function isLowSignalAcknowledgementText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.startsWith("agree,") && normalized.split(/\s+/).length <= 4) {
    return true;
  }
  return [
    "agree",
    "agreed",
    "ok",
    "okay",
    "yes",
    "no",
    "nope",
    "yep",
    "proceed",
    "continue",
    "go ahead",
    "sounds good",
    "do it",
    "fix it",
    "proceed with your recommendation",
    "resume",
    "clear",
    "agree with your suggestion",
    "agree with your proposal",
    "agree with your recommendation",
  ].includes(normalized);
}

function isStructuredPayloadText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.some(isStructuredPromptPayload);
    }
    return isStructuredPromptPayload(parsed);
  } catch {
    return false;
  }
}

function isStructuredPromptPayload(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Object.hasOwn(value, "system") ||
    Object.hasOwn(value, "messages") ||
    Object.hasOwn(value, "developer") ||
    Object.hasOwn(value, "instructions")
  );
}

function isTerminalTranscriptText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return /^[\w.-]+@[\w.-]+\s+\S+\s+% /.test(normalized) || normalized.startsWith("Last login:");
}

function isStandaloneAttachmentText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("<image ") ||
    /^["']?\/.+\.(png|jpe?g|webp|gif|heic|pdf)["']?$/i.test(trimmed) ||
    /^["']?\/.*screenshot/i.test(trimmed)
  );
}

function isGeneratedHandoffText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    normalized.startsWith("fix the selected agent skills findings in this repository.") ||
    normalized.startsWith(
      "you are operating inside an existing software repository. your task is",
    ) ||
    (normalized.startsWith("repository: /") && normalized.includes("read-only")) ||
    (normalized.startsWith("repo: /") && normalized.includes("architecture")) ||
    normalized.startsWith("read-only architecture exploration in /") ||
    (normalized.startsWith("we are in /") && normalized.includes("user invoked improve")) ||
    (normalized.startsWith("explore /") && normalized.includes("architectural"))
  );
}

function isLocalPageInspectionText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    normalized.startsWith("now check this page ") &&
    (normalized.includes("http://localhost") || normalized.includes("https://localhost"))
  );
}

function isRenderedOutputDumpText(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("┌") || trimmed.startsWith("╭") || trimmed.startsWith("│");
}

function isLogDumpText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)\s+(ERROR|WARN|INFO|DEBUG)\b/.test(
    normalized,
  );
}

function isRiskReportDumpText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.startsWith("i still have all this ## risk reasons");
}

function isCiLogDumpText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    normalized.startsWith("why the ci is failing ") &&
    (normalized.includes("getting action download") ||
      normalized.includes("prepare all required actions"))
  );
}

function isLikelyAssistantResponseText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (
    normalized.startsWith("committed and pushed:") ||
    normalized.startsWith("committed all current changes")
  ) {
    return true;
  }
  if (normalized.startsWith("implemented ")) {
    return true;
  }
  if (isLikelyAssistantReviewReport(normalized)) {
    return true;
  }
  return normalized.startsWith("fixed.") && hasAssistantSummarySection(normalized);
}

function isLikelyAssistantReviewReport(text: string): boolean {
  const startsLikeReviewReport =
    text.startsWith("i found some issue in the current diff") ||
    text.startsWith("i found some issues in the current diff");
  return startsLikeReviewReport && hasAssistantReviewReportMarker(text);
}

function hasAssistantReviewReportMarker(text: string): boolean {
  return (
    text.includes("verification run:") ||
    text.includes("verification:") ||
    text.includes("validation:") ||
    text.includes("i reproduced ") ||
    text.includes("i did not run the test")
  );
}

function hasAssistantSummarySection(text: string): boolean {
  return (
    text.includes("changed:") ||
    text.includes("validation:") ||
    text.includes("verification passed:") ||
    text.includes("blocked:")
  );
}

function firstKnownValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
