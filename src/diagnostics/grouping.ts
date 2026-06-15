import type { Diagnostic } from "./types.js";

export type DiagnosticRuleGroup = readonly [ruleKey: string, diagnostics: Diagnostic[]];

export function compareByRulePriority(
  ruleKeyA: string,
  ruleKeyB: string,
  rulePriority: ReadonlyMap<string, number> | undefined,
): number {
  const priorityA = rulePriority?.get(ruleKeyA);
  const priorityB = rulePriority?.get(ruleKeyB);
  if (priorityA === undefined && priorityB === undefined) {
    return 0;
  }
  if (priorityA === undefined) {
    return 1;
  }
  if (priorityB === undefined) {
    return -1;
  }
  return priorityB - priorityA;
}

export function buildSortedRuleGroups(
  diagnostics: ReadonlyArray<Diagnostic>,
  rulePriority?: ReadonlyMap<string, number>,
): DiagnosticRuleGroup[] {
  const groups = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
    const group = groups.get(ruleKey);
    if (group === undefined) {
      groups.set(ruleKey, [diagnostic]);
    } else {
      group.push(diagnostic);
    }
  }

  return [...groups.entries()].toSorted(([ruleKeyA], [ruleKeyB]) =>
    compareByRulePriority(ruleKeyA, ruleKeyB, rulePriority),
  );
}
