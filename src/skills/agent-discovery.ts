import * as path from "node:path";
import type { ExtractedPrompt, HistorySource } from "../history/types.js";
import type { WorkflowCandidate } from "../prompts/types.js";
import type { CommandLauncher } from "../system/exec.js";
import { buildDraftInvocation, type DraftExecutable } from "./draft.js";
import { sanitizeSkillName } from "./paths.js";

export const AGENT_DISCOVERY_TEMPLATE_VERSION = "ritual-agent-discovery-v1";

export type AgentDiscoveryParseResult = {
  candidates: WorkflowCandidate[];
  warnings: string[];
};

type AgentDiscoveryCandidate = {
  name: string;
  summary: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
  scope: "project" | "global";
  representativePrompts: string[];
  sourcePaths: string[];
  repeatCount?: number;
};

type RawAgentDiscoveryReport = {
  candidates?: unknown;
};

type RawAgentDiscoveryCandidate = {
  name?: unknown;
  summary?: unknown;
  rationale?: unknown;
  confidence?: unknown;
  scope?: unknown;
  representativePrompts?: unknown;
  sourcePaths?: unknown;
  repeatCount?: unknown;
};

export function buildAgentDiscoveryHandoffPrompt(options: {
  cwd: string;
  sources: HistorySource[];
  reportPath: string;
}): string {
  const sourceList = options.sources
    .map((source, index) => `${index + 1}. [${source.kind}] ${source.path}`)
    .join("\n");

  return `Template version: ${AGENT_DISCOVERY_TEMPLATE_VERSION}

Analyze local recorded Claude and Codex sessions to identify workflows worth turning into reusable agent skills.

Repository root:
${options.cwd}

Recorded session and history paths:
${sourceList}

Report path:
${options.reportPath}

Task:
- Read the listed local files directly. They may contain JSON or JSONL records.
- Identify repeated or high-value user workflows that would make useful reusable skills.
- Prefer workflows with clear repeated intent, concrete steps, repo/tool conventions, or recurring review/debug/test/documentation patterns.
- Ignore one-off questions, vague requests, generated output, logs, assistant responses, and private details that should not become reusable instructions.
- Do not create any SKILL.md files.
- Do not ask the user questions.
- Do not modify history/session files.
- Write exactly one UTF-8 JSON object to the report path and create the parent directory if needed.
- Do not wrap the JSON in Markdown fences.

JSON schema:
{
  "candidates": [
    {
      "name": "lowercase-hyphen-skill-name",
      "summary": "one sentence user-facing summary",
      "rationale": "why this workflow is worth a skill",
      "confidence": "high",
      "scope": "project",
      "representativePrompts": [
        "generalized representative user request without secrets"
      ],
      "sourcePaths": [
        "/absolute/source/file.jsonl"
      ],
      "repeatCount": 3
    }
  ]
}

Allowed confidence values: high, medium, low.
Allowed scope values: project, global.
Return an empty candidates array if nothing is worth turning into a skill.
`;
}

export async function launchAgentDiscovery(options: {
  cwd: string;
  sources: HistorySource[];
  reportPath: string;
  executable: DraftExecutable;
  launcher: CommandLauncher;
}): Promise<number> {
  const prompt = buildAgentDiscoveryHandoffPrompt({
    cwd: options.cwd,
    sources: options.sources,
    reportPath: options.reportPath,
  });
  return options.launcher.launch(buildDraftInvocation(options.executable, prompt), {
    cwd: options.cwd,
  });
}

export function parseAgentDiscoveryReport(
  content: string,
  sources: HistorySource[],
): AgentDiscoveryParseResult {
  const warnings: string[] = [];
  const parsed = parseJsonObject(content);
  if (!isRawReport(parsed)) {
    return { candidates: [], warnings: ["Agent discovery report was not a JSON object."] };
  }

  const rawCandidates = parsed.candidates;
  if (!Array.isArray(rawCandidates)) {
    return { candidates: [], warnings: ["Agent discovery report did not contain candidates[]."] };
  }

  const candidates: WorkflowCandidate[] = [];
  rawCandidates.forEach((rawCandidate, index) => {
    const candidate = parseCandidate(rawCandidate, index, sources);
    if (candidate === undefined) {
      warnings.push(`Skipped malformed agent discovery candidate ${index + 1}.`);
      return;
    }
    candidates.push(candidate);
  });

  return { candidates, warnings };
}

export function agentDiscoveryReportPath(cwd: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(cwd, ".ritual", "sessions", `agent-discovery-${stamp}.json`);
}

function parseJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const objectText = extractJsonObject(content);
    if (objectText === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(objectText);
    } catch {
      return undefined;
    }
  }
}

function extractJsonObject(content: string): string | undefined {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }
  return content.slice(start, end + 1);
}

function parseCandidate(
  value: unknown,
  index: number,
  sources: HistorySource[],
): WorkflowCandidate | undefined {
  if (!isRawCandidate(value)) {
    return undefined;
  }

  const nameValue = stringValue(value.name);
  const summary = stringValue(value.summary);
  const rationale = stringValue(value.rationale);
  const confidence = confidenceField(value.confidence);
  const scope = scopeField(value.scope);
  const representativePrompts = stringArrayField(value.representativePrompts);
  const sourcePaths = stringArrayField(value.sourcePaths);
  if (
    nameValue === undefined ||
    summary === undefined ||
    rationale === undefined ||
    confidence === undefined ||
    scope === undefined ||
    representativePrompts.length === 0
  ) {
    return undefined;
  }

  const fallbackSource = sources[0];
  const sourcePath = sourcePaths[0] ?? fallbackSource?.path ?? "agent-discovery";
  const sourceKind = fallbackSource?.kind ?? "codex";
  const prompts: ExtractedPrompt[] = representativePrompts.slice(0, 5).map((text, promptIndex) => ({
    id: `agent-discovery-${index + 1}-${promptIndex + 1}`,
    source: sourceKind,
    sourcePath,
    text,
  }));
  const repeatCount = positiveIntegerField(value.repeatCount);
  const count = Math.max(repeatCount ?? prompts.length, prompts.length);
  const skillName = sanitizeSkillName(nameValue) || `agent-candidate-${index + 1}`;

  return {
    id: `agent-candidate-${index + 1}`,
    name: skillName,
    summary: summary.trim(),
    prompts,
    representativePrompts: prompts.slice(0, 3),
    count,
    coherence: confidence === "high" ? 1 : confidence === "medium" ? 0.75 : 0.5,
    rankScore: confidence === "high" ? count + 3 : confidence === "medium" ? count + 2 : count,
    rankReason: rationale.trim(),
    isStrong: true,
    discoverySource: "agent",
    confidence,
    recommendedScope: scope,
  };
}

function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRawReport(value: unknown): value is RawAgentDiscoveryReport {
  return isRecord(value);
}

function isRawCandidate(value: unknown): value is RawAgentDiscoveryCandidate {
  return isRecord(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function stringArrayField(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function confidenceField(value: unknown): AgentDiscoveryCandidate["confidence"] | undefined {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function scopeField(value: unknown): AgentDiscoveryCandidate["scope"] | undefined {
  return value === "project" || value === "global" ? value : undefined;
}

function positiveIntegerField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
