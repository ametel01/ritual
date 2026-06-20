import type { ExtractedPrompt } from "../history/types.js";
import { lexicalSimilarity, normalizePrompts } from "./normalize.js";
import type { ClusterOptions, NormalizedPrompt, WorkflowCandidate } from "./types.js";
import { DEFAULT_CLUSTER_OPTIONS } from "./types.js";

type MutableCluster = {
  prompts: NormalizedPrompt[];
};

export function clusterPrompts(
  prompts: Parameters<typeof normalizePrompts>[0],
  options: ClusterOptions = DEFAULT_CLUSTER_OPTIONS,
): WorkflowCandidate[] {
  const normalized = normalizePrompts(prompts);
  const clusters: MutableCluster[] = [];

  for (const prompt of normalized) {
    const match = clusters.find(
      (cluster) => averageSimilarity(prompt, cluster) >= options.similarityThreshold,
    );
    if (match === undefined) {
      clusters.push({ prompts: [prompt] });
    } else {
      match.prompts.push(prompt);
    }
  }

  return clusters
    .filter((cluster) => cluster.prompts.length >= options.nearMissThreshold)
    .map((cluster, index) => {
      const sourcePrompts = cluster.prompts.map((prompt) => prompt.prompt);
      const representativePrompts = recentPrompts(sourcePrompts).slice(0, 3);
      const coherence = clusterCoherence(cluster);
      const name = candidateName(cluster.prompts.flatMap((prompt) => prompt.tokens));
      const count = sourcePrompts.length;
      const isStrong = count >= options.strongThreshold;
      const rankScore = count * 10 + coherence * 8 + averageDetailScore(sourcePrompts);
      return {
        id: `candidate-${index + 1}`,
        name,
        summary: summaryFromPrompt(
          representativePrompts[0]?.text ?? sourcePrompts[0]?.text ?? name,
        ),
        prompts: sourcePrompts,
        representativePrompts,
        count,
        coherence,
        rankScore,
        rankReason: `${count} similar prompt${count === 1 ? "" : "s"} found; ${isStrong ? "good skill candidate" : "possible skill candidate"}.`,
        isStrong,
      };
    })
    .sort((left, right) => right.rankScore - left.rankScore);
}

export async function clusterPromptsAsync(
  prompts: Parameters<typeof normalizePrompts>[0],
  options: ClusterOptions = DEFAULT_CLUSTER_OPTIONS,
): Promise<WorkflowCandidate[]> {
  const normalized = normalizePrompts(prompts);
  const clusters: MutableCluster[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    if (index > 0 && index % 25 === 0) {
      await yieldToEventLoop();
    }
    const prompt = normalized[index];
    if (prompt === undefined) {
      continue;
    }
    const match = clusters.find(
      (cluster) => averageSimilarity(prompt, cluster) >= options.similarityThreshold,
    );
    if (match === undefined) {
      clusters.push({ prompts: [prompt] });
    } else {
      match.prompts.push(prompt);
    }
  }

  const candidates: WorkflowCandidate[] = [];
  const eligibleClusters = clusters.filter(
    (cluster) => cluster.prompts.length >= options.nearMissThreshold,
  );
  for (let index = 0; index < eligibleClusters.length; index += 1) {
    if (index > 0 && index % 10 === 0) {
      await yieldToEventLoop();
    }
    const cluster = eligibleClusters[index];
    if (cluster === undefined) {
      continue;
    }
    candidates.push(await buildCandidate(cluster, index, options));
  }

  return candidates.sort((left, right) => right.rankScore - left.rankScore);
}

export function mergeCandidates(
  primary: WorkflowCandidate,
  secondary: WorkflowCandidate,
): WorkflowCandidate {
  const prompts = [...primary.prompts, ...secondary.prompts];
  const merged = clusterPrompts(prompts, {
    strongThreshold: 3,
    nearMissThreshold: 1,
    similarityThreshold: 0,
  })[0];
  if (merged === undefined) {
    return primary;
  }
  return {
    ...merged,
    id: primary.id,
    name: primary.name,
    prompts,
    representativePrompts: prompts.slice(0, 3),
    count: prompts.length,
    rankReason: `Merged ${primary.name} with ${secondary.name}; ${prompts.length} combined prompts.`,
    isStrong: prompts.length >= 3,
  };
}

function averageSimilarity(prompt: NormalizedPrompt, cluster: MutableCluster): number {
  const total = cluster.prompts.reduce(
    (sum, existing) => sum + lexicalSimilarity(prompt, existing),
    0,
  );
  return total / cluster.prompts.length;
}

async function buildCandidate(
  cluster: MutableCluster,
  index: number,
  options: ClusterOptions,
): Promise<WorkflowCandidate> {
  const sourcePrompts = cluster.prompts.map((prompt) => prompt.prompt);
  const representativePrompts = recentPrompts(sourcePrompts).slice(0, 3);
  const coherence = await clusterCoherenceAsync(cluster);
  const name = candidateName(cluster.prompts.flatMap((prompt) => prompt.tokens));
  const count = sourcePrompts.length;
  const isStrong = count >= options.strongThreshold;
  const rankScore = count * 10 + coherence * 8 + averageDetailScore(sourcePrompts);
  return {
    id: `candidate-${index + 1}`,
    name,
    summary: summaryFromPrompt(representativePrompts[0]?.text ?? sourcePrompts[0]?.text ?? name),
    prompts: sourcePrompts,
    representativePrompts,
    count,
    coherence,
    rankScore,
    rankReason: `${count} similar prompt${count === 1 ? "" : "s"} found; ${isStrong ? "good skill candidate" : "possible skill candidate"}.`,
    isStrong,
  };
}

function clusterCoherence(cluster: MutableCluster): number {
  if (cluster.prompts.length < 2) {
    return 1;
  }
  let total = 0;
  let comparisons = 0;
  for (let left = 0; left < cluster.prompts.length; left += 1) {
    for (let right = left + 1; right < cluster.prompts.length; right += 1) {
      const leftPrompt = cluster.prompts[left];
      const rightPrompt = cluster.prompts[right];
      if (leftPrompt !== undefined && rightPrompt !== undefined) {
        total += lexicalSimilarity(leftPrompt, rightPrompt);
        comparisons += 1;
      }
    }
  }
  return comparisons === 0 ? 0 : total / comparisons;
}

async function clusterCoherenceAsync(cluster: MutableCluster): Promise<number> {
  if (cluster.prompts.length < 2) {
    return 1;
  }
  let total = 0;
  let comparisons = 0;
  for (let left = 0; left < cluster.prompts.length; left += 1) {
    if (left > 0 && left % 25 === 0) {
      await yieldToEventLoop();
    }
    for (let right = left + 1; right < cluster.prompts.length; right += 1) {
      const leftPrompt = cluster.prompts[left];
      const rightPrompt = cluster.prompts[right];
      if (leftPrompt !== undefined && rightPrompt !== undefined) {
        total += lexicalSimilarity(leftPrompt, rightPrompt);
        comparisons += 1;
      }
    }
  }
  return comparisons === 0 ? 0 : total / comparisons;
}

function averageDetailScore(prompts: ExtractedPrompt[]): number {
  const total = prompts.reduce((sum, prompt) => {
    const words = prompt.text.trim().split(/\s+/).length;
    return sum + Math.min(words / 35, 1);
  }, 0);
  return prompts.length === 0 ? 0 : total / prompts.length;
}

function recentPrompts(prompts: ExtractedPrompt[]): ExtractedPrompt[] {
  return prompts
    .map((prompt, index) => ({ prompt, index, timestamp: promptTimestamp(prompt) }))
    .sort((left, right) => right.timestamp - left.timestamp || left.index - right.index)
    .map((entry) => entry.prompt);
}

function promptTimestamp(prompt: ExtractedPrompt): number {
  if (prompt.createdAt === undefined) {
    return 0;
  }
  const timestamp = Date.parse(prompt.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function candidateName(tokens: string[]): string {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (isNoisyNameToken(token)) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const selected = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([token]) => token.replace(/[^a-z0-9-]/g, ""))
    .filter((token) => token.length > 0);
  return selected.length === 0 ? "repeated-workflow" : selected.join("-");
}

function isNoisyNameToken(token: string): boolean {
  if (token.length > 32) {
    return true;
  }
  if (token.includes("/") || token.includes("\\") || token.includes(".")) {
    return true;
  }
  return [
    "file",
    "files",
    "image",
    "jpeg",
    "jpg",
    "png",
    "source",
    "tmp",
    "user",
    "users",
  ].includes(token);
}

function summaryFromPrompt(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  return cleaned.length <= 120 ? cleaned : `${cleaned.slice(0, 117)}...`;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
