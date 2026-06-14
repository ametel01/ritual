# Implementation Plan

## Source Document
- Paths:
  - `/Users/alexmetelli/source/ritual/docs/PRD.md`
  - `/Users/alexmetelli/source/ritual/docs/TECH_SPEC.md`
- Summary: Build Ritual, a production-grade TypeScript npm CLI invoked as `npx ritual@latest`, that scans local Claude and Codex user prompt history, finds repeated workflow candidates, guides one approved candidate through interactive review, drafts a reusable `SKILL.md` with a local agent executable, validates it, and writes it to selected Claude and/or Codex/agents skill targets.

## Goals
- Provide one interactive command with no MVP subcommands or flags.
- Discover Claude and Codex local history sources and extract only user-authored prompts.
- Normalize, cluster, and rank repeated prompts locally without uploading history.
- Let the user inspect, merge, rename, approve, or reject candidates, generating at most one skill per run.
- Recommend project-local or global scope and let the user choose Claude, Codex/agents, or both output ecosystems.
- Invoke `claude` or `codex exec` only after explicit user approval.
- Write drafts under `.ritual/drafts/<skill-name>/SKILL.md`, support user editing, validate the draft, and block final writes on structural errors.
- Write the same approved `SKILL.md` to all selected targets with overwrite protection and clear final path output.
- Ship with strict TypeScript, Biome, Vitest, build verification, CI, release automation, and npm packaging checks.

## Non-Goals
- Automatic skill generation without user review.
- Batch skill generation.
- CLI subcommands or flags in the MVP.
- A general-purpose history browser.
- Cloud accounts, sync, shared team registries, or hosted semantic indexing.
- Uploading local history during discovery, extraction, clustering, or ranking.
- Ecosystem-specific skill variants or ecosystem metadata files.
- Guaranteeing generated skill quality without human review.

## Assumptions and Open Questions
- Assumption: The repository is intentionally pre-implementation; only `README.md` is tracked, while `CHANGELOG.md`, `docs/PRD.md`, and `docs/TECH_SPEC.md` are currently untracked. Implementation steps should preserve these user-authored files.
- Assumption: The package manager will be npm because the technical specification requires `npx`, `npm ci`, and `npm run verify`.
- Assumption: Biome is the formatter and linter; ESLint and Prettier should not be introduced.
- Assumption: Vitest is the test runner and TypeScript is compiled with strict ESM settings.
- Assumption: Interactive prompts can use a small npm prompt library, with `@inquirer/prompts` as the initial candidate unless Step 2 finds a better fit.
- Open question: Which active Node.js LTS major should be the minimum runtime? Impact: affects `package.json` `engines.node`, CI matrix, and published package compatibility.
- Open question: Which Claude and Codex history formats are supported first? Impact: affects parser fixtures and discovery order.
- Open question: Which lexical similarity algorithm and thresholds are acceptable for MVP clustering? Impact: affects ranking quality and user trust.
- Open question: What versioning scheme should be used for the embedded skill-generation prompt? Impact: affects future migrations and support.
- Open question: What exact global Claude and Codex/agents skill directories should be supported per OS? Impact: affects final-write safety.
- Open question: Should generated skills include provenance comments or omit them to reduce history leakage? Impact: affects privacy and draft usefulness.
- Open question: What body length should trigger the "too long" validation warning? Impact: affects warning behavior and tests.

## Quality Gates
- Setup status: Setup required. No `package.json`, lockfile, Biome config, TypeScript config, Vitest config, source tree, test tree, or CI workflow exists yet.
- Baseline command: `npm run verify` after Step 1 creates the npm project and aggregate script. Before Step 1 this command is expected to be unavailable.
- Format command: `npm run check`
- Lint command: `npm run check`
- Test command: `npm run test`
- Additional gates:
  - Typecheck: `npm run typecheck`
  - Build: `npm run build`
  - Aggregate verification: `npm run verify`
  - Package audit before release work: `npm pack --dry-run`

## Progress Tracking
- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step, validation results, commit reference if available, current status, and next step.

## Incremental Steps

### Step 0: Progress Tracking Setup
Goal: Create a durable progress log the user can consult while the plan is being executed.

Depends on:
- None

Changes:
- Create `PROGRESS.md` in the project root.
- Add the plan title/source, a checklist for every step in this plan, current status, and an update log.
- Document that `PROGRESS.md` must be updated after every completed step.

Acceptance criteria:
- `PROGRESS.md` exists.
- `PROGRESS.md` includes every planned step and a current-status field.
- `PROGRESS.md` explains the after-each-step update requirement.

Validation:
- Confirm `PROGRESS.md` exists and contains the step checklist.

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the current status, and identify Step 1 as next.

Commit:
- `docs: add implementation progress tracking`

### Step 1: Quality Gates Setup
Goal: Bootstrap the TypeScript npm project and make the required quality gates runnable before product implementation starts.

Depends on:
- Step 0

Changes:
- Add `package.json` with:
  - `type: "module"`
  - `bin.ritual` pointing at the compiled CLI entrypoint.
  - scripts: `check`, `typecheck`, `test`, `build`, `verify`.
  - package metadata needed for npm distribution.
- Add `package-lock.json` through `npm install` after choosing exact dependencies.
- Add strict `tsconfig.json` with all options required by `docs/TECH_SPEC.md`.
- Add `tsconfig.build.json` that emits production JavaScript and source maps.
- Add `biome.json` configured for formatting, linting, import organization, and no unsafe suppressions without a reason.
- Add `vitest.config.ts`.
- Add minimal source files required for gates to pass, likely `src/index.ts` and `src/cli/main.ts`.
- Add a minimal smoke test under `test/unit/`.
- Add `.gitignore` entries for `node_modules/`, `dist/`, coverage output, npm package artifacts, and `.ritual/` runtime drafts/sessions if appropriate.
- Add `.github/workflows/ci.yml` that runs `npm ci` and `npm run verify` on pull requests and default-branch pushes.
- Update `README.md` with basic development commands only if needed to document the newly introduced gates.

Acceptance criteria:
- A clean checkout can run `npm ci`.
- `npm run verify` fails on formatting, lint, type, test, or build errors.
- CI uses the same aggregate gate as local development.
- The scaffold does not implement product behavior beyond a harmless CLI placeholder.

Validation:
- Run `npm ci`
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 2 as next.

Commit:
- `build: scaffold typescript quality gates`

### Step 2: CLI Entry Flow Skeleton
Goal: Establish the one-command interactive application shell without implementing domain-heavy behavior yet.

Depends on:
- Step 0
- Step 1

Changes:
- Implement `src/cli/main.ts` as the executable entrypoint.
- Implement `src/cli/interactive.ts` as a thin session controller.
- Add terminal-safe output and cancellation handling.
- Ensure the CLI has no MVP subcommands or flags.
- Wire a placeholder sequence matching the required application flow so later steps can fill in real modules.
- Add tests that verify the CLI starts the interactive controller and does not expose subcommands or flags.
- Update `README.md` with `npx ritual@latest` and local development invocation once the entrypoint exists.

Acceptance criteria:
- The compiled package exposes a `ritual` executable.
- Running the local CLI reaches the interactive controller.
- The CLI does not require or document MVP flags/subcommands.
- Side effects are behind injectable wrappers where tests need control.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 3 as next.

Commit:
- `feat: add interactive cli shell`

### Step 3: History Discovery And Prompt Extraction
Goal: Discover supported Claude and Codex history sources and extract user prompts with resilient diagnostics.

Depends on:
- Step 0
- Step 1
- Step 2

Changes:
- Add shared history types in `src/history/types.ts`, including `ExtractedPrompt` and diagnostic result types.
- Implement `src/history/discover.ts` for independent Claude and Codex source discovery.
- Implement `src/history/parse-claude.ts` and `src/history/parse-codex.ts` for the first supported history formats.
- Add `src/telemetry/diagnostics.ts` for local-only source diagnostics output.
- Add parser fixtures under `test/fixtures/history/`.
- Add unit tests for:
  - Claude parser user-prompt extraction.
  - Codex parser user-prompt extraction.
  - malformed records returning diagnostics instead of crashing.
  - partial source failure with successful continuation.
  - no assistant responses, tool outputs, system messages, or metadata appearing as extracted prompts.

Acceptance criteria:
- Discovery reports which sources were scanned and how many prompts were extracted per source.
- Malformed or unsupported files produce diagnostics and do not stop other sources.
- Tests never read the developer's real local history.
- Extracted prompts preserve original text and source metadata.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 4 as next.

Commit:
- `feat: extract prompts from local agent history`

### Step 4: Prompt Normalization, Clustering, And Ranking
Goal: Turn extracted prompts into locally ranked repeated workflow candidates.

Depends on:
- Step 0
- Step 1
- Step 3

Changes:
- Implement `src/prompts/normalize.ts` to normalize comparison text while preserving originals.
- Implement `src/prompts/cluster.ts` with local lexical similarity and configurable thresholds.
- Implement `src/prompts/rank.ts` to score candidates by recurrence, coherence, and prompt usefulness.
- Add candidate domain types shared with the interactive layer.
- Add tests for whitespace/casing normalization, conservative stop-word handling, similarity grouping, recurrence threshold behavior, near-miss behavior, ranking reasons, and original prompt preservation.

Acceptance criteria:
- Strong candidates default to at least 3 similar prompts.
- Sparse results can expose near-misses with a threshold of 2, but generation is not defaulted.
- Ranking includes a human-readable reason for each candidate.
- One-off, vague, or low-signal prompts are deprioritized.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 5 as next.

Commit:
- `feat: rank repeated workflow candidates`

### Step 5: Candidate Review Interaction
Goal: Let the user inspect candidates and select, reject, rename, or merge exactly one candidate for drafting.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 4

Changes:
- Extend `src/cli/interactive.ts` with candidate list and detail prompts.
- Add interaction helpers for approve, reject, rename, merge, and sparse-results threshold lowering.
- Ensure the flow can return to candidate selection when a candidate is too vague.
- Add tests using mocked prompt adapters for:
  - candidate detail viewing.
  - rejecting candidates.
  - approving one candidate.
  - renaming a candidate.
  - merging two candidates.
  - no-strong-candidate path with near-misses and no default generation.

Acceptance criteria:
- The terminal shows candidate name, count, summary, rank reason, and representative prompts.
- At most one candidate can proceed to drafting.
- No strong candidate path does not generate by default.
- Review logic is testable without real terminal input.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 6 as next.

Commit:
- `feat: add candidate review flow`

### Step 6: Scope Recommendation And Target Path Resolution
Goal: Recommend skill scope, collect output ecosystem choices, and resolve safe target paths.

Depends on:
- Step 0
- Step 1
- Step 5

Changes:
- Implement `src/skills/paths.ts` for:
  - skill name sanitization.
  - project-local Claude path resolution.
  - project-local Codex/agents path resolution.
  - global Claude path resolution.
  - global Codex/agents path resolution.
- Add scope recommendation logic based on repo paths, local commands, frameworks, CI, package managers, project names, and task-generic wording.
- Extend the interactive flow to confirm project-local/global scope and Claude, Codex/agents, or both ecosystems.
- Add overwrite detection that requires interactive confirmation before replacing an existing skill.
- Add tests for scope recommendation, sanitized names, target paths, path traversal prevention, existing skill detection, and project-local defaults inside a repository.

Acceptance criteria:
- Running inside a repository defaults to project-local scope and both ecosystems.
- Final target paths match the selected scope and ecosystem targets.
- Existing skills are never overwritten without explicit confirmation.
- Unsafe skill names cannot escape the intended skill root.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 7 as next.

Commit:
- `feat: resolve safe skill target paths`

### Step 7: Embedded Generation Template And Agent Invocation
Goal: Draft one high-quality `SKILL.md` from the approved candidate through an explicitly approved local agent invocation.

Depends on:
- Step 0
- Step 1
- Step 5
- Step 6

Changes:
- Add `src/skills/generation-template.ts` with a versioned embedded prompt derived from `skill-creator`.
- Implement `src/system/exec.ts` for injectable subprocess execution.
- Implement `src/skills/draft.ts` to:
  - detect supported drafting executables.
  - build the generation prompt from approved candidate details, representative prompts, rank rationale, selected scope, and target ecosystems.
  - explicitly show the invocation before running it.
  - invoke `claude` or `codex exec` only after user approval.
  - detect too-vague candidates and offer to return to candidate selection.
- Add tests for template contents, prompt versioning, executable selection, command construction, approval gating, missing executable errors, and no invocation before approval.

Acceptance criteria:
- Runtime does not depend on the user's installed `skill-creator`.
- The drafting template requires exactly one `SKILL.md` with valid skill frontmatter and actionable body instructions.
- No local agent executable is called before user confirmation.
- Missing `claude`/`codex` produces a clear recoverable error.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 8 as next.

Commit:
- `feat: draft skills with approved local agent invocation`

### Step 8: Draft Workspace, Editor, And Validation
Goal: Store the draft under `.ritual/drafts`, allow human editing, and validate blocking errors and warnings before final approval.

Depends on:
- Step 0
- Step 1
- Step 7

Changes:
- Implement `src/system/filesystem.ts` for injectable filesystem operations and atomic writes where practical.
- Implement `src/system/editor.ts` to open `$EDITOR` when available and fall back to approve, reject, or retry prompts.
- Implement `src/skills/validate.ts` with built-in validation for:
  - missing `SKILL.md`.
  - invalid YAML frontmatter.
  - frontmatter fields other than `name` and `description`.
  - missing `name` or `description`.
  - non-hyphen-case skill name.
  - empty or placeholder body.
  - weak trigger description.
  - generic body warnings.
  - missing workflow-step warnings.
  - bundled resource references without files.
  - body length warning.
- Integrate optional `agnix` validation when available, while preserving built-in validation as sufficient for MVP.
- Add tests for draft creation, editor fallback, all blocking errors, all warnings, `agnix` present/unavailable paths, and final approval behavior.

Acceptance criteria:
- Drafts are written to `.ritual/drafts/<skill-name>/SKILL.md`.
- The user can inspect and edit the draft before validation.
- Blocking errors prevent final writes.
- Warning-only results let the user decide whether to continue.
- Built-in validation works when `agnix` is not installed.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 9 as next.

Commit:
- `feat: validate editable skill drafts`

### Step 9: Final Skill Writes And Draft Cleanup
Goal: Write the validated skill to every selected target and let the user keep or delete the draft workspace.

Depends on:
- Step 0
- Step 1
- Step 6
- Step 8

Changes:
- Implement `src/skills/write.ts` for final writes to selected Claude and Codex/agents targets.
- Create parent directories only after final approval.
- Use atomic or idempotent writes where practical.
- Preserve the same `SKILL.md` contents for every selected target.
- Extend the interactive flow to ask whether to keep or delete the draft workspace after successful final writes.
- Print final output paths.
- Add tests for project-local Claude write, project-local Codex/agents write, both-target write, global write confirmation, parent directory creation timing, overwrite confirmation, idempotent retry behavior, and draft cleanup choice.

Acceptance criteria:
- The same final `SKILL.md` is written to all selected targets.
- Parent directories are not created before user approval.
- Existing skills are protected by confirmation.
- Final paths are printed after successful writes.
- Draft workspace retention or deletion follows the user's choice.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 10 as next.

Commit:
- `feat: write approved skills to selected targets`

### Step 10: End-To-End Interactive Session Coverage
Goal: Prove the full MVP flow works with fixtures and temporary directories, without touching real user history or real skill roots.

Depends on:
- Step 0
- Step 1
- Step 3
- Step 4
- Step 5
- Step 6
- Step 7
- Step 8
- Step 9

Changes:
- Add integration test harnesses under `test/integration/` with mocked prompt answers, subprocesses, editor behavior, and temporary filesystem roots.
- Add fixture histories representing Claude, Codex, malformed files, sparse results, and repeatable workflow prompts.
- Cover required integration cases:
  - end-to-end dry session using fixture history.
  - partial source failure with continuation.
  - no strong candidates path.
  - near-miss threshold lowering.
  - draft creation under `.ritual/drafts`.
  - final write to project-local Claude target.
  - final write to project-local Codex/agents target.
  - final write to both targets.
- Add privacy assertions that tests never read real Claude or Codex history paths.

Acceptance criteria:
- Integration tests exercise the complete guided flow without real terminal, agent, editor, history, or skill-root side effects.
- The full MVP happy path is covered.
- Failure and sparse-result paths are covered.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 11 as next.

Commit:
- `test: cover ritual end-to-end session flow`

### Step 11: Release And npm Publishing Automation
Goal: Add tag-driven release automation and package verification for npm distribution.

Depends on:
- Step 0
- Step 1
- Step 10

Changes:
- Add or update `.github/workflows/release.yml` to:
  - trigger only on `push` tags matching `v*`.
  - run `npm ci`.
  - run `npm run verify`.
  - build the package.
  - publish to npm.
  - create or update a GitHub Release.
- Prefer npm trusted publishing with provenance when available.
- Use least-privilege workflow permissions, including `id-token: write` only when trusted publishing/provenance is configured and `contents: write` only for GitHub Release creation.
- Add package publication metadata, `files`, source maps, and any required npm ignore/package include settings.
- Add a package dry-run check to release documentation or scripts if useful.
- Update `CHANGELOG.md` for release-process additions.

Acceptance criteria:
- Ordinary branch pushes do not publish.
- `v*` tags run the release gate before publishing.
- Local and CI release gates use `npm run verify`.
- `npm pack --dry-run` includes compiled JavaScript, source maps, and required runtime assets only.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`
- Run `npm pack --dry-run`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and Step 12 as next.

Commit:
- `ci: add npm release automation`

### Step 12: Production Readiness Documentation And Final MVP Audit
Goal: Align documentation with implemented behavior and verify the MVP is ready for first release review.

Depends on:
- Step 0
- Step 1
- Step 11

Changes:
- Update `README.md` with:
  - `npx ritual@latest` usage.
  - local development commands.
  - privacy expectations.
  - supported history sources.
  - output paths.
  - release process.
- Update `CHANGELOG.md` with user-facing MVP changes.
- Review `docs/PRD.md` and `docs/TECH_SPEC.md` for any implementation-driven clarifications, without rewriting product intent.
- Add any missing troubleshooting notes for missing `claude`, missing `codex`, missing `$EDITOR`, unsupported history formats, and unavailable `agnix`.
- Run a final package dry-run and document any intentional package contents.

Acceptance criteria:
- Documentation matches implemented commands and behavior.
- Privacy boundaries are explicit.
- Release checklist is clear enough for a maintainer to tag and publish.
- All open questions that were resolved during implementation are reflected in docs or tracked as future work.

Validation:
- Run `npm run check`
- Run `npm run typecheck`
- Run `npm run test`
- Run `npm run build`
- Run `npm run verify`
- Run `npm pack --dry-run`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and the plan status as complete or awaiting release.

Commit:
- `docs: document ritual mvp workflow`

## Step Completion Rule

Every implementation step must end with:

1. Run all quality gates listed for that step.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit reference if available, current status, and next step.
4. Create the suggested commit, or record the actual commit reference in `PROGRESS.md` if the message changes.
