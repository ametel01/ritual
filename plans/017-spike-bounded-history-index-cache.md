# Plan 017: Spike a bounded local history index or cache strategy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
> `git diff --stat d5148d0..HEAD -- docs/PRD.md docs/TECH_SPEC.md src/history/discover.ts README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/013-filter-injected-context-boundary.md`, `plans/014-bound-history-discovery-and-parsing.md`
- **Category**: direction
- **Planned at**: commit `d5148d0`, 2026-06-21

## Why this matters

Plan 014 bounds immediate scan work, but it does not answer whether Ritual
should eventually avoid re-scanning unchanged local history on every run. A
cache or local index could make large histories much faster, but history data is
sensitive and the PRD says scan and fallback clustering results are ephemeral by
default. This plan is a design spike: produce a decision-quality document, not a
cache implementation.

## Current state

- `docs/PRD.md` defines privacy constraints and product principles.
- `docs/TECH_SPEC.md` defines local-only parsing, prompt dump behavior, and
  history parsing requirements.
- `src/history/discover.ts` currently scans files directly.
- Plan 014 will add immediate bounds before this spike should execute.

Relevant excerpts:

```md
<!-- docs/PRD.md:25 -->
## Product Principles

- The default interface is `bunx ritualai@latest`.
- Lightweight inspection can use `bunx ritualai@latest prompts` or `bunx ritualai@latest --prompts`.
- The default skill-generation flow must not require flags.
- All decisions happen through interactive prompts.
- The primary artifact is one high-quality `SKILL.md`.
- The user must approve before any skill is written.
- History data stays local by default.
```

```md
<!-- docs/PRD.md:241 -->
## Data Handling Requirements

- Treat local history as sensitive developer data.
- Do not upload history by default.
- Extract and process history locally.
- Keep scan and fallback cluster results ephemeral by default.
- Do not persist agent discovery findings.
```

```md
<!-- docs/TECH_SPEC.md:100 -->
Running `ritual prompts` or `ritual --prompts` must:
1. Discover the same default Claude and Codex history sources as the interactive flow.
2. Extract user prompts only.
3. Sort prompts by `createdAt` descending, with undated prompts last.
4. Write at most 100 prompts by default.
```

```ts
// src/history/discover.ts:73
export async function scanHistorySources(sources: HistorySource[]): Promise<HistoryScanResult> {
```

Repo conventions to match:

- Use Markdown docs for product and technical decisions.
- Do not add implementation code during a spike plan.
- Keep privacy trade-offs explicit rather than hidden in implementation details.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Lint/format check | `bun run check` | exit 0, no diagnostics |
| Full gate | `bun run verify` | exit 0 |

## Scope

**In scope**:

- Create `docs/history-index-cache-spike.md`
- Optionally update `docs/TECH_SPEC.md` to link to the spike or add a future
  open question.
- Optionally update `README.md` only if the spike produces a user-facing future
  decision worth documenting now.
- `plans/README.md` status row update

**Out of scope**:

- Implementing a cache, index, database, or new CLI flag.
- Persisting prompt text.
- Changing history parsing or discovery code.
- Adding dependencies.
- Changing privacy behavior.

## Git workflow

- Branch, if the operator wants one: `advisor/017-history-index-cache-spike`.
- Commit message suggestion: `docs: spike history index cache strategy`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Create the spike document

Create `docs/history-index-cache-spike.md` with these sections:

- `# History Index/Cache Spike`
- `## Problem`
- `## Current behavior`
- `## Privacy constraints`
- `## Options`
- `## Recommendation`
- `## Non-goals`
- `## Open questions`
- `## Acceptance criteria for a future implementation`

Keep it concise but decision-quality. The document should let a maintainer
decide whether to implement a cache later.

**Verify**: `test -f docs/history-index-cache-spike.md` exits 0.

### Step 2: Analyze at least three options

In the `Options` section, cover at least these:

- **No cache; bounded scans only**: rely on Plan 014, simplest privacy posture.
- **Metadata-only index**: store file path, size, mtime, and last scan status,
  but do not persist prompt text.
- **Prompt summary cache**: store extracted prompt metadata or normalized text
  to speed ranking, with explicit privacy risks and opt-in/clear requirements.

For each option, include:

- Performance benefit.
- Privacy cost.
- Invalidation story.
- Failure mode.
- Rough implementation effort.

**Verify**:
`rg -n "No cache|Metadata-only index|Prompt summary cache" docs/history-index-cache-spike.md`
shows all three options.

### Step 3: Make a recommendation consistent with the PRD

The recommendation must not contradict the PRD's ephemeral-by-default
requirement. A safe default recommendation is:

- Ship bounded scans first.
- Do not persist prompt text by default.
- If caching is later needed, start with a metadata-only index.
- Any prompt-text cache must be explicit opt-in and include a clear/delete path.

If you recommend something else, justify the privacy trade-off directly.

**Verify**:
`rg -n "ephemeral|prompt text|opt-in|metadata-only|clear" docs/history-index-cache-spike.md`
returns matches supporting the recommendation.

### Step 4: Link or record the decision path

Optionally update `docs/TECH_SPEC.md` Open Questions or Production Readiness
with a single reference to the spike. Do not rewrite the spec around an
unimplemented cache.

Suggested shape:

```md
- See `docs/history-index-cache-spike.md` before adding any persistent history cache.
```

**Verify**: `bun run check` exits 0.

## Test plan

This is a documentation/design spike. No automated tests are required.

Review checklist:

- The spike does not propose uploading history.
- The spike does not persist prompt text by default.
- The spike explicitly says Plan 014's bounded scans should land first.
- The spike defines acceptance criteria for any future implementation.

## Done criteria

- [ ] `docs/history-index-cache-spike.md` exists.
- [ ] The spike compares at least three options.
- [ ] The recommendation is privacy-preserving and consistent with PRD data handling.
- [ ] Any optional spec update links to the spike without claiming implementation exists.
- [ ] `bun run check` exits 0.
- [ ] `bun run verify` exits 0.
- [ ] No files outside the in-scope list are modified except the optional status row in `plans/README.md`.

## STOP conditions

Stop and report back if:

- The maintainer wants a cache implemented immediately instead of a spike.
- Plan 014 has not landed and the operator wants to execute plans strictly in
  dependency order.
- The PRD has changed to allow persisted prompt text by default.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

This spike should prevent premature caching work. If a future executor
implements caching, reviewers should require explicit invalidation behavior,
privacy documentation, and tests proving the cache does not read or write real
developer history.
