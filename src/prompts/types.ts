import type { ExtractedPrompt } from "../history/types.js";

export type NormalizedPrompt = {
  prompt: ExtractedPrompt;
  normalizedText: string;
  tokens: string[];
};

export type WorkflowCandidate = {
  id: string;
  name: string;
  summary: string;
  prompts: ExtractedPrompt[];
  representativePrompts: ExtractedPrompt[];
  count: number;
  coherence: number;
  rankScore: number;
  rankReason: string;
  isStrong: boolean;
  discoverySource?: "local" | "agent";
  confidence?: "high" | "medium" | "low";
  recommendedScope?: "project" | "global";
};

export type ClusterOptions = {
  strongThreshold: number;
  nearMissThreshold: number;
  similarityThreshold: number;
};

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = {
  strongThreshold: 3,
  nearMissThreshold: 2,
  similarityThreshold: 0.25,
};
