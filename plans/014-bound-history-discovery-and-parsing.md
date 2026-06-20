# Plan 014: Bound history discovery and parsing work

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
> `git diff --stat d5148d0..HEAD -- src/history/discover.ts src/history/types.ts test/unit/history.test.ts README.md docs/TECH_SPEC.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/013-filter-injected-context-boundary.md`
- **Category**: perf
- **Planned at**: commit `d5148d0`, 2026-06-21

## Why this matters

Ritual scans local Claude and Codex history, including recursive session
directories. Today discovery recursively enumerates every supported JSON/JSONL
file and scanning reads each file fully into memory before parsing. On a real
machine with years of sessions, this can make the first run or `ritual prompts
--limit 100` slow, memory-heavy, or effectively stuck. The fix should bound the
work, emit diagnostics when something is skipped, and keep partial-success
behavior intact.

## Current state

- `src/history/discover.ts` discovers default and extra history sources, scans
  files, and deduplicates mirrored prompt records.
- `src/history/types.ts` defines `Diagnostic`, `HistoryDiscoveryOptions`, and
  scan result shapes.
- `test/unit/history.test.ts` contains discovery and scanning tests.
- `README.md` and `docs/TECH_SPEC.md` document prompt dumping and local scanning
  behavior.

Relevant excerpts:

```ts
// src/history/discover.ts:16
export async function discoverHistorySources(options: HistoryDiscoveryOptions): Promise<{
  sources: HistorySource[];
  diagnostics: Diagnostic[];
}> {
```

```ts
// src/history/discover.ts:73
export async function scanHistorySources(sources: HistorySource[]): Promise<HistoryScanResult> {
  const sourceResults: SourceScanResult[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const source of sources) {
    try {
      const content = await readFile(source.path, "utf8");
```

```ts
// src/history/discover.ts:182
async function discoverFiles(rootPath: string): Promise<string[]> {
  const rootStat = await stat(rootPath);
  if (rootStat.isFile()) {
    return HISTORY_EXTENSIONS.has(path.extname(rootPath)) ? [rootPath] : [];
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return discoverFiles(entryPath);
      }
```

```ts
// src/history/parse-shared.ts:44
const lines = content.split(/\r?\n/);
```

Documented behavior:

```md
<!-- docs/TECH_SPEC.md:100 -->
Running `ritual prompts` or `ritual --prompts` must:
1. Discover the same default Claude and Codex history sources as the interactive flow.
2. Extract user prompts only.
3. Sort prompts by `createdAt` descending, with undated prompts last.
4. Write at most 100 prompts by default.
```

Repo conventions to match:

- Discovery and scanning continue after individual source failures and report
  diagnostics instead of throwing through the CLI.
- Diagnostics use `{ level, message, sourcePath }`.
- Tests use temporary directories and fixtures; they must not read real user
  history.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Focused tests | `bun run test -- test/unit/history.test.ts` | exit 0, all history tests pass |
| Typecheck | `bun run typecheck` | exit 0, no errors |
| Lint/format check | `bun run check` | exit 0, no diagnostics |
| Full gate | `bun run verify` | exit 0 |

## Scope

**In scope**:

- `src/history/discover.ts`
- `src/history/types.ts`
- `test/unit/history.test.ts`
- `README.md`, only if user-facing limits need documenting
- `plans/README.md` status row update

**Out of scope**:

- Rewriting the parser to a streaming JSONL parser.
- Adding a persistent cache or index; that is covered by Plan 017 as a design
  spike.
- Changing prompt ranking, clustering thresholds, or candidate scoring.
- Changing default history source locations.
- Adding new dependencies.

## Git workflow

- Branch, if the operator wants one: `advisor/014-bound-history-scan`.
- Commit message suggestion: `fix: bound history scan work`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add explicit scan and discovery option types

In `src/history/types.ts`, add option shapes for bounded work. Keep them small
and dependency-free.

Target shape:

```ts
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
```

In `src/history/discover.ts`, import the new `HistoryScanOptions` type and add
module-level defaults. Use conservative high defaults to avoid surprising
ordinary users while still making the work bounded:

```ts
const DEFAULT_MAX_FILES_PER_ROOT = 5_000;
const DEFAULT_MAX_HISTORY_FILE_BYTES = 25 * 1024 * 1024;
```

If the maintainer wants different defaults, change the constants, but keep them
centralized and tested with tiny override values.

**Verify**: `bun run typecheck` exits 0 or fails only because the new options
are not yet wired into implementation. Continue to Step 2 if the failure is the
expected not-yet-wired type error.

### Step 2: Bound recursive discovery and emit truncation diagnostics

Replace `discoverFiles(rootPath): Promise<string[]>` with a bounded helper that
returns both files and whether the traversal hit the cap.

Suggested shape:

```ts
type DiscoveredFiles = {
  files: string[];
  truncated: boolean;
};
```

Implementation requirements:

- Preserve existing behavior for file roots: supported `.json`/`.jsonl` files
  return one source; unsupported file roots return no files.
- For directory roots, recursively discover supported files until
  `maxFilesPerRoot` is reached.
- Do not use unbounded `Promise.all` over every nested entry. A simple sequential
  depth-first traversal is acceptable and easier to reason about.
- Sort returned file paths before returning to preserve deterministic tests.
- When truncation occurs, push a `warning` diagnostic on the candidate root path.
  The message should be clear, for example:
  `History discovery stopped after 5000 supported files. Add a narrower extra source if needed.`

**Verify**: `bun run test -- test/unit/history.test.ts` may fail until tests are
updated in Step 4, but existing non-cap discovery tests should still be easy to
update to expect the same sources.

### Step 3: Bound file reads during scanning and emit skip diagnostics

Change `scanHistorySources` to accept an optional second argument:

```ts
export async function scanHistorySources(
  sources: HistorySource[],
  options: HistoryScanOptions = {},
): Promise<HistoryScanResult> {
```

Before reading a source, call `stat(source.path)` and compare `size` to
`options.maxFileBytes ?? DEFAULT_MAX_HISTORY_FILE_BYTES`.

When a file exceeds the limit:

- Do not call `readFile`.
- Add a `warning` diagnostic with `sourcePath`.
- Add a `SourceScanResult` for that source with `prompts: []` and the warning
  diagnostic, matching the existing partial-failure pattern.
- Continue scanning the remaining sources.

When `stat` or `readFile` fails, preserve the current error behavior and message
style.

**Verify**: `bun run typecheck` exits 0.

### Step 4: Add focused tests for bounded behavior

In `test/unit/history.test.ts`, add tests under `describe("history discovery")`
and `describe("history scanning")`.

Discovery test:

- Create a temp directory with two supported history files.
- Call `discoverHistorySources({ cwd, homeDir, extraSources: [{ kind: "codex", path: tempDir }], maxFilesPerRoot: 1 })`.
- Assert exactly one source from that temp root is returned.
- Assert a warning diagnostic mentions discovery stopping after the cap.

Scan test:

- Create one small valid history file and one oversized history file.
- Call `scanHistorySources([...], { maxFileBytes: 10 })`.
- Assert the small file still produces prompts.
- Assert the oversized file produces no prompts and has a warning diagnostic.
- Assert the top-level `result.diagnostics` includes the warning.

**Verify**: `bun run test -- test/unit/history.test.ts` exits 0.

### Step 5: Update user-facing docs only if defaults are now user-visible

If the implementation uses hard default caps that users can hit, update
`README.md` troubleshooting with one concise bullet explaining that very large
history files or overly broad extra directories are skipped with diagnostics.

Do not document internal option names unless they are exposed through the CLI.

**Verify**: `bun run check` exits 0.

## Test plan

- Add unit coverage for capped recursive discovery.
- Add unit coverage for skipping oversized history files while preserving
  partial success.
- Existing discovery tests for `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, archived
  sessions, unreadable directories, and deduplication must continue to pass.

## Done criteria

- [ ] Discovery has a default file-count cap per root.
- [ ] Scanning has a default file-size cap per source.
- [ ] Cap hits emit warning diagnostics and do not crash.
- [ ] Partial success behavior remains intact.
- [ ] `bun run test -- test/unit/history.test.ts` exits 0.
- [ ] `bun run typecheck` exits 0.
- [ ] `bun run check` exits 0.
- [ ] `bun run verify` exits 0.
- [ ] No files outside the in-scope list are modified except the optional status row in `plans/README.md`.

## STOP conditions

Stop and report back if:

- The maintainer rejects default caps and wants purely streaming behavior
  instead.
- Realistic fixture behavior shows 25 MiB is too low for normal prompt-history
  files.
- Bounding discovery requires changing the public CLI flow or prompts.
- A verification command fails twice after a reasonable fix attempt.

## Maintenance notes

This plan is an immediate safety bound, not the final large-history strategy.
Plan 017 covers whether Ritual should eventually maintain an index/cache. A
reviewer should scrutinize diagnostics and defaults carefully: silently dropping
history would be worse than slow scanning.
