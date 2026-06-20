# Plan 018: Tighten existing-skill duplicate scoring

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
> `git diff --stat d5148d0..HEAD -- src/skills/duplicates.ts test/unit/skills.test.ts README.md docs/PRD.md docs/TECH_SPEC.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d5148d0`, 2026-06-21

## Why this matters

Ritual suppresses fallback candidates that appear to be covered by existing
project-local or global skills. That is useful only when the existing skill
really covers the candidate. The current duplicate score divides token overlap
by the smaller token set, so a short or generic existing skill can suppress a
larger, distinct workflow just because all of the short skill's tokens appear in
the candidate. Users then never see a potentially valuable repeated workflow,
which contradicts the documented "already covered" behavior.

## Current state

- `src/skills/duplicates.ts` discovers existing skills and filters workflow
  candidates before interactive fallback review.
- `test/unit/skills.test.ts` contains one positive duplicate-detection test but
  no false-positive coverage.
- `README.md`, `docs/PRD.md`, and `docs/TECH_SPEC.md` document the expected
  duplicate suppression contract.

Relevant excerpts:

```ts
// src/skills/duplicates.ts:30
const DUPLICATE_THRESHOLD = 0.42;
```

```ts
// src/skills/duplicates.ts:54
for (const candidate of candidates) {
  const match = bestMatch(candidate, existingSkills);
  if (match !== undefined && match.score >= DUPLICATE_THRESHOLD) {
    covered.push({ candidate, skill: match.skill, score: match.score });
  } else {
    available.push(candidate);
  }
}
```

```ts
// src/skills/duplicates.ts:108
function duplicateScore(candidate: WorkflowCandidate, skill: ExistingSkill): number {
  if (candidate.name === skill.name) {
    return 1;
  }
  const candidateTokens = tokensForText(
    [
      candidate.name,
      candidate.summary,
      ...candidate.representativePrompts.map((prompt) => prompt.text),
    ].join(" "),
  );
  const skillTokens = tokensForText(`${skill.name}\n${skill.text}`);
  if (candidateTokens.size === 0 || skillTokens.size === 0) {
    return 0;
  }
  const intersection = [...candidateTokens].filter((token) => skillTokens.has(token)).length;
  const smallerSetSize = Math.min(candidateTokens.size, skillTokens.size);
  return intersection / smallerSetSize;
}
```

Existing test coverage only verifies a true positive:

```ts
// test/unit/skills.test.ts:48
describe("skill duplicate detection", () => {
  it("filters candidates already covered by existing skills", async () => {
```

Documented behavior:

```md
<!-- README.md:88 -->
Ritual skips repeated workflow candidates that are already covered by an existing
project-local or global Claude/Codex skill.
```

```md
<!-- docs/PRD.md:137 -->
- Tell the discovery agent to inspect existing project/global Claude and Codex/agents skill directories before returning findings.
- Suppress workflows already covered by existing skills, and keep partially covered workflows only when the missing behavior is substantial.
```

```md
<!-- docs/TECH_SPEC.md:85 -->
8. Remove candidates already covered by existing project-local or global skills.
```

Repo conventions to match:

- Skill duplicate tests use temp directories and inline `SKILL.md` contents.
- Candidate objects in tests are plain `WorkflowCandidate`-shaped literals.
- Text comparison should remain local-only and dependency-free.
- Exact skill-name matches should remain a hard duplicate because target names
  are the write-path identity.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Focused tests | `bun run test -- test/unit/skills.test.ts` | exit 0, all skill tests pass |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint/format check | `bun run check` | exit 0, no diagnostics |
| Full gate | `bun run verify` | exit 0 |

## Scope

**In scope**:

- `src/skills/duplicates.ts`
- `test/unit/skills.test.ts`
- `plans/README.md` status row update

**Out of scope**:

- Changing prompt clustering or ranking in `src/prompts/*`.
- Changing existing skill discovery roots or filesystem behavior.
- Changing agent discovery handoff instructions.
- Adding fuzzy-match dependencies.
- Changing user-facing docs unless the suppression contract itself changes,
  which this plan should avoid.

## Git workflow

- Branch, if the operator wants one: `advisor/018-tighten-duplicate-skill-scoring`.
- Commit message suggestion: `fix: tighten existing skill duplicate scoring`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add a false-positive duplicate regression test

In `test/unit/skills.test.ts`, add a test under
`describe("skill duplicate detection")` that proves a short existing skill does
not suppress a richer, distinct candidate.

Use this shape:

- Create a temp `cwd` and `homeDir`.
- Write one existing project-local skill under
  `.claude/skills/review-tests/SKILL.md`.
- Keep the existing skill intentionally short and narrow, for example:

```md
---
name: review-tests
description: Use when reviewing test-only diffs for missing assertions.
---

Review changed test files and check assertion quality.
```

- Create a candidate named something distinct, for example
  `review-release-automation`, whose summary and representative prompt include
  some overlapping generic tokens such as `review` and `tests`, but whose core
  workflow is release automation, changelog extraction, package publishing, and
  GitHub releases.
- Call `filterCoveredCandidates`.
- Assert the candidate remains in `available` and `covered` is empty.

The important property is that the old smaller-set denominator would classify
the candidate as covered because the existing skill's small token set mostly
appears in the candidate. If your first fixture does not fail against the old
implementation, make the existing skill shorter or the overlap clearer while
keeping the workflows distinct.

**Verify**: `bun run test -- test/unit/skills.test.ts` should fail before the
scoring fix because the new candidate is incorrectly covered.

### Step 2: Preserve exact-name matches as hard duplicates

Before changing text scoring, make the intended exact-name behavior explicit in
tests if it is not already obvious:

- The existing positive test currently uses matching candidate and skill names.
- Keep that test passing.
- If you refactor fixtures, retain one test where `candidate.name === skill.name`
  and the candidate is covered with score `1`.

**Verify**: `bun run test -- test/unit/skills.test.ts` still fails only on the
new false-positive case.

### Step 3: Replace smaller-set scoring with a bidirectional coverage score

In `src/skills/duplicates.ts`, update `duplicateScore` so non-name matches must
show meaningful overlap from both perspectives. A simple acceptable approach is:

```ts
const intersection = [...candidateTokens].filter((token) => skillTokens.has(token)).length;
const candidateCoverage = intersection / candidateTokens.size;
const skillCoverage = intersection / skillTokens.size;
return Math.min(candidateCoverage, skillCoverage);
```

This prevents a tiny existing skill from suppressing a broad candidate just
because the tiny token set is contained in the broad candidate.

If this makes true positives too strict, prefer a slightly more explicit helper
over magic tuning. For example, keep exact-name matches as `1`, then require
both:

- `candidateCoverage >= 0.42`
- `skillCoverage >= 0.42`

and return the lower coverage as the score. Do not return to dividing by the
smaller set only.

**Verify**: `bun run test -- test/unit/skills.test.ts` exits 0.

### Step 4: Consider exposing match diagnostics only in tests

If the tests are hard to understand, add a small unexported helper such as
`bidirectionalDuplicateScore` only if it improves clarity. Avoid changing public
exports unless needed. The product output currently reports only a skipped count,
and this plan should not add new CLI output.

**Verify**: `bun run typecheck` exits 0.

### Step 5: Run the local quality gates

**Verify**:

- `bun run test -- test/unit/skills.test.ts` exits 0.
- `bun run typecheck` exits 0.
- `bun run check` exits 0.
- `bun run verify` exits 0.

## Test plan

- Add one false-positive regression test for a short/narrow existing skill that
  should not suppress a broader distinct candidate.
- Preserve the existing true-positive test for a candidate already covered by an
  existing skill.
- Optional: add one true-positive text-overlap test where names differ but the
  existing skill text substantially covers the candidate workflow, if useful for
  confidence.

## Done criteria

- [ ] Exact candidate-name matches still suppress candidates.
- [ ] Short/generic existing skills no longer suppress broader distinct candidates.
- [ ] Duplicate text scoring uses bidirectional coverage or an equivalent
      non-smaller-set-only strategy.
- [ ] No new runtime dependencies are added.
- [ ] `bun run test -- test/unit/skills.test.ts` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run check` exits 0.
- [ ] `bun run verify` exits 0.
- [ ] No files outside the in-scope list are modified except the optional status row in `plans/README.md`.

## STOP conditions

Stop and report back if:

- Product direction changes to intentionally suppress partially overlapping
  workflows by default.
- A realistic true-positive duplicate cannot be preserved without reintroducing
  the smaller-set false positive.
- The fix appears to require changing clustering/ranking behavior outside
  `src/skills/duplicates.ts`.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

Duplicate suppression is intentionally conservative: false negatives show the
user a redundant candidate, but false positives hide useful workflows. Reviewers
should prefer visible redundant candidates over suppressing candidates that
represent substantial missing behavior. If future matching needs semantic
understanding, design it separately rather than tuning this lexical threshold
blindly.
